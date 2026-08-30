from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import uuid

from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access, verify_private_owner_visibility, visible_account_ids
from src.services.account_service import sync_transaction_to_balances
from src.services.market_data import fetch_and_cache_exchange_rates
from src.services.transaction_service import create_transaction
from src.services import ledger_service, recurring_service, budget_service

router = APIRouter(prefix="/cashflow", tags=["Income & Expenses"])

# --- TRANSACTIONS ---


def _with_split(
    db: Session, transactions: List[models.Transaction]
) -> List[schemas.TransactionResponse]:
    """
    Attach each row's counterparty split, read back from the ledger.

    The split is not a column: it lives in the journal entry, where it cannot
    drift out of step with the receivable it created. One grouped query covers
    the whole page, so a list endpoint pays for it once rather than per row.
    """
    splits = ledger_service.counterparty_split_by_transaction(db, [t.id for t in transactions])
    responses = []
    for row in transactions:
        response = schemas.TransactionResponse.model_validate(row)
        response.splits = [
            schemas.TransactionSplitRow(
                counterparty_id=line.counterparty_id,
                counterparty_name=line.counterparty_name,
                amount=line.amount,
            )
            for line in splits.get(row.id, [])
        ]
        responses.append(response)
    return responses


def _load_counterparty(
    db: Session, household_id: uuid.UUID, counterparty_id: uuid.UUID
) -> models.Counterparty:
    counterparty = (
        db.query(models.Counterparty)
        .filter(
            models.Counterparty.id == counterparty_id,
            models.Counterparty.household_id == household_id,
        )
        .first()
    )
    if not counterparty:
        raise HTTPException(status_code=404, detail="Counterparty not found")
    return counterparty


def _resolve_splits(
    db: Session, household_id: uuid.UUID, splits: Optional[List["schemas.TransactionSplitInput"]]
) -> list[tuple[models.Counterparty, Decimal]]:
    """Load and validate the counterparties a split refers to, once per call."""
    if not splits:
        return []
    ids = [s.counterparty_id for s in splits]
    counterparties = {
        c.id: c
        for c in db.query(models.Counterparty).filter(models.Counterparty.id.in_(ids)).all()
    }
    resolved = []
    for split in splits:
        counterparty = counterparties.get(split.counterparty_id)
        if counterparty is None or counterparty.household_id != household_id:
            raise HTTPException(status_code=404, detail="Counterparty not found")
        resolved.append((counterparty, split.amount))
    return resolved


def _validated_card_category(
    db: Session, category_id, account: models.FinancialAccount
):
    """
    Check a card-category pick actually belongs to the account being charged.

    A card category is one card's private taxonomy, so tagging a purchase on
    account A with a category from card B is meaningless rather than merely
    unusual — it would meter the wrong card. Rejected rather than silently
    dropped, because the user picked something specific.
    """
    if category_id is None:
        return None
    card_category = (
        db.query(models.CardCategory)
        .join(models.Card, models.CardCategory.card_id == models.Card.id)
        .filter(
            models.CardCategory.id == category_id,
            models.Card.financial_account_id == account.id,
        )
        .first()
    )
    if not card_category:
        raise HTTPException(
            status_code=400,
            detail="That card category belongs to a different card.",
        )
    return card_category.id


@router.post("/transactions", response_model=schemas.TransactionResponse, status_code=status.HTTP_201_CREATED)
def log_transaction(
    transaction: schemas.TransactionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transaction.account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    db_category = db.query(models.Category).filter(models.Category.id == transaction.category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")

    if db_account.household_id != db_category.household_id:
        raise HTTPException(status_code=400, detail="Account and Category must belong to the same household")

    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    # Currency conversion + balance sync live in the shared service so the
    # recurring engine posts through exactly this path.
    db_transaction = create_transaction(
        db,
        account=db_account,
        category=db_category,
        date=transaction.date,
        amount=transaction.amount,
        currency=transaction.currency,
        exchange_rate=transaction.exchange_rate,
        description=transaction.description,
        splits=_resolve_splits(db, db_account.household_id, transaction.splits),
        # A receivable arising from a private account stays private, the same way
        # the account it was paid from does.
        owner_user_id=db_account.owner_user_id,
        mcc=transaction.mcc,
        card_category_id=_validated_card_category(db, transaction.card_category_id, db_account),
    )

    db.commit()
    db.refresh(db_transaction)
    return _with_split(db, [db_transaction])[0]

@router.post("/transfers", response_model=List[schemas.TransactionResponse], status_code=status.HTTP_201_CREATED)
def create_transfer(
    transfer: schemas.TransferCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # 1. Verify access to both accounts
    from_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transfer.from_account_id).first()
    to_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transfer.to_account_id).first()
    
    if not from_account or not to_account:
        raise HTTPException(status_code=404, detail="One or both accounts not found")
    
    verify_household_access(from_account.household_id, current_user, db)
    verify_household_access(to_account.household_id, current_user, db)
    verify_private_owner_visibility(from_account.owner_user_id, current_user)
    verify_private_owner_visibility(to_account.owner_user_id, current_user)

    if from_account.household_id != to_account.household_id:
        raise HTTPException(status_code=400, detail="Transfer must be within the same household")

    if from_account.id == to_account.id:
        raise HTTPException(status_code=400, detail="Cannot transfer to the same account")

    # 2. Find/Create "Transfer" category
    transfer_cat = db.query(models.Category).filter(
        models.Category.household_id == from_account.household_id,
        models.Category.name == models.SYSTEM_CATEGORY_TRANSFER
    ).first()
    
    if not transfer_cat:
        transfer_cat = models.Category(
            id=uuid.uuid7(),
            household_id=from_account.household_id,
            name=models.SYSTEM_CATEGORY_TRANSFER,
            type="expense" # Base type for the category table, but we override in transaction
        )
        db.add(transfer_cat)
        db.flush()

    # 3. Handle Cross-Currency Transfer
    from_curr = from_account.currency or "USD"
    to_curr = to_account.currency or "USD"
    home_curr = from_account.household.base_currency or "USD"
    
    rate = 1.0
    if from_curr != to_curr:
        rate = fetch_and_cache_exchange_rates(db, from_curr, to_curr, transfer.date.date())

    rate_from_to_home = fetch_and_cache_exchange_rates(db, from_curr, home_curr, transfer.date.date())
    rate_to_to_home = fetch_and_cache_exchange_rates(db, to_curr, home_curr, transfer.date.date())

    transfer_id = uuid.uuid7()
    
    # Withdrawal from source account (in source currency)
    withdrawal = models.Transaction(
        id=uuid.uuid7(),
        account_id=transfer.from_account_id,
        category_id=transfer_cat.id,
        date=transfer.date,
        amount=transfer.amount,
        amount_home_currency=transfer.amount * Decimal(str(rate_from_to_home)),
        currency=from_curr,
        exchange_rate=1.0, # Source account is the reference
        description=transfer.description or f"Transfer to {to_account.name}",
        transaction_type=models.TransactionType.expense,
        transfer_id=transfer_id
    )
    
    # Deposit to destination account (converted to destination currency)
    deposit_amount = float(transfer.amount) * rate
    deposit = models.Transaction(
        id=uuid.uuid7(),
        account_id=transfer.to_account_id,
        category_id=transfer_cat.id,
        date=transfer.date,
        amount=Decimal(str(deposit_amount)),
        amount_home_currency=Decimal(str(deposit_amount)) * Decimal(str(rate_to_to_home)),
        currency=to_curr,
        exchange_rate=1.0, 
        description=transfer.description or f"Transfer from {from_account.name}",
        transaction_type=models.TransactionType.income,
        transfer_id=transfer_id
    )
    
    db.add(withdrawal)
    db.add(deposit)
    db.flush()
    
    # 5. Sync balances
    sync_transaction_to_balances(db, transfer.from_account_id, transfer.date.date(), -transfer.amount)
    sync_transaction_to_balances(db, transfer.to_account_id, transfer.date.date(), Decimal(str(deposit_amount)))

    # 6. One ledger entry for the pair. Two rows, but a single event.
    ledger_service.post_transfer(
        db, transfer_id=transfer_id, withdrawal=withdrawal, deposit=deposit
    )

    db.commit()
    db.refresh(withdrawal)
    db.refresh(deposit)
    
    return [withdrawal, deposit]


@router.get(
    "/transactions/household/{household_id}",
    response_model=List[schemas.TransactionResponse],
)
def get_household_transactions(
    household_id: uuid.UUID,
    # Newest-first cap for consumers that only show a handful of recent rows (the
    # Dashboard's "Recent Activity" wants five). Without it every client downloads and
    # decodes the household's entire history on every load, which is most of what a
    # multi-year household pays for a cold start. Omitted = full history, unordered, as
    # before, which is what the Transactions screens still need.
    limit: Optional[int] = Query(None, ge=1),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    # Only accounts this user may see. Filtering on household alone would return the
    # transactions of another member's *private* accounts — amounts, descriptions and all —
    # to anyone in the household. The clients filter these out for display, but the API is
    # where the rule has to hold (see AGENTS.md 4a); `update_transaction` below already
    # enforces it per-row, so read and write would otherwise disagree on the same data.
    account_ids = visible_account_ids(db, household_id, current_user)

    if not account_ids:
        return []

    query = db.query(models.Transaction).filter(models.Transaction.account_id.in_(account_ids))
    if limit is not None:
        # Ordered only when limited: "the newest N" is meaningless without it, and the
        # unlimited path stays byte-for-byte what it was.
        query = query.order_by(models.Transaction.date.desc()).limit(limit)
    return _with_split(db, query.all())

@router.put(
    "/transactions/{transaction_id}", response_model=schemas.TransactionResponse
)
def update_transaction(
    transaction_id: uuid.UUID,
    transaction_update: schemas.TransactionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_transaction = db.query(models.Transaction).filter(models.Transaction.id == transaction_id).first()
    if not db_transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_transaction.account_id).first()
    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    # Capture old impact for sync before any modifications
    # Capture old impact for sync before any modifications
    old_multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    old_exchange_rate = db_transaction.exchange_rate if db_transaction.exchange_rate else 1.0
    old_impact = (db_transaction.amount * Decimal(str(old_exchange_rate))) * old_multiplier
    old_date = db_transaction.date.date()

    if transaction_update.account_id:
        new_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transaction_update.account_id).first()
        if not new_account:
            raise HTTPException(status_code=404, detail="New account not found")
        if new_account.household_id != db_account.household_id:
            raise HTTPException(status_code=400, detail="New account must belong to the same household")

    if transaction_update.category_id:
        new_category = db.query(models.Category).filter(models.Category.id == transaction_update.category_id).first()
        if not new_category:
            raise HTTPException(status_code=404, detail="New category not found")
        if new_category.household_id != db_account.household_id:
            raise HTTPException(status_code=400, detail="New category must belong to the same household")
        db_transaction.transaction_type = new_category.type

    update_data = transaction_update.model_dump(exclude_unset=True)
    # The split is not a column on this row — it is applied to the ledger entry
    # further down. Setting it here would put a stray attribute on the model.
    column_updates = {
        k: v for k, v in update_data.items() if k != "splits"
    }

    # A card category belongs to one card. Moving the transaction to another
    # account — or to a bank account with no card at all — makes the existing
    # pick meaningless, so it is cleared rather than left dangling into another
    # card's taxonomy. An explicit pick in the same request still wins, and is
    # validated against the account the row is moving to.
    target_account = db_account
    if transaction_update.account_id:
        target_account = db.query(models.FinancialAccount).filter(
            models.FinancialAccount.id == transaction_update.account_id
        ).first()

    if "card_category_id" in column_updates:
        column_updates["card_category_id"] = _validated_card_category(
            db, column_updates["card_category_id"], target_account
        )
    elif transaction_update.account_id and target_account.id != db_transaction.account_id:
        column_updates["card_category_id"] = None

    for key, value in column_updates.items():
        setattr(db_transaction, key, value)

    # Recalculate amount_home_currency if needed
    if any(k in column_updates for k in ('amount', 'currency', 'date', 'account_id')):
        target_account = db_account
        if transaction_update.account_id:
            target_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == transaction_update.account_id).first()
        
        home_curr = target_account.household.base_currency or "USD"
        trans_curr = db_transaction.currency or target_account.currency or "USD"
        rate_to_home = fetch_and_cache_exchange_rates(db, trans_curr, home_curr, db_transaction.date.date())
        db_transaction.amount_home_currency = db_transaction.amount * Decimal(str(rate_to_home))

    # Calculate new impact
    # Calculate new impact
    new_multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    new_exchange_rate = db_transaction.exchange_rate if db_transaction.exchange_rate else 1.0
    new_impact = (db_transaction.amount * Decimal(str(new_exchange_rate))) * new_multiplier
    new_date = db_transaction.date.date()

    if old_date == new_date:
        sync_transaction_to_balances(db, db_transaction.account_id, new_date, new_impact - old_impact)
    else:
        sync_transaction_to_balances(db, db_transaction.account_id, old_date, -old_impact)
        sync_transaction_to_balances(db, db_transaction.account_id, new_date, new_impact)

    # Repost rather than patch: `post_entry` replaces the entry this row already
    # had, so an edited amount can never leave a stale half of it behind. The
    # split is carried over unless the caller changed it — editing the
    # description of a shared dinner should not quietly make it all yours.
    db.flush()
    target_account = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.id == db_transaction.account_id
    ).first()
    if "splits" in update_data:
        splits = _resolve_splits(db, db_account.household_id, transaction_update.splits)
    else:
        existing = ledger_service.counterparty_split_by_transaction(db, [db_transaction.id]).get(
            db_transaction.id, []
        )
        counterparties = {
            c.id: c
            for c in db.query(models.Counterparty)
            .filter(models.Counterparty.id.in_([line.counterparty_id for line in existing]))
            .all()
        }
        splits = [(counterparties[line.counterparty_id], line.amount) for line in existing]
    # A reduced amount can strand a split that no longer fits inside it —
    # `post_transaction` already clamps each share against what's left as it
    # posts, so a stale carried-forward split just shrinks rather than
    # unbalancing the entry.
    ledger_service.post_transaction(
        db,
        db_transaction,
        splits=splits,
        owner_user_id=target_account.owner_user_id if target_account else None,
    )

    db.commit()
    db.refresh(db_transaction)
    return _with_split(db, [db_transaction])[0]

@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_transaction = db.query(models.Transaction).filter(models.Transaction.id == transaction_id).first()
    if not db_transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_transaction.account_id).first()
    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    # Reverse impact
    # Reverse impact
    multiplier = 1 if db_transaction.transaction_type == models.TransactionType.income else -1
    exchange_rate = db_transaction.exchange_rate if db_transaction.exchange_rate else 1.0
    sync_transaction_to_balances(db, db_transaction.account_id, db_transaction.date.date(), -(db_transaction.amount * Decimal(str(exchange_rate)) * multiplier))
    
    transfer_id = db_transaction.transfer_id
    ledger_service.delete_entry_for(db, models.JournalSource.transaction, db_transaction.id)
    if transfer_id:
        ledger_service.delete_entry_for(db, models.JournalSource.transfer, transfer_id)
    db.delete(db_transaction)

    # If transfer, delete counterpart
    if transfer_id:
        counterpart = db.query(models.Transaction).filter(
            models.Transaction.transfer_id == transfer_id,
            models.Transaction.id != transaction_id
        ).first()
        if counterpart:
            counterpart_multiplier = 1 if counterpart.transaction_type == models.TransactionType.income else -1
            counterpart_exchange = counterpart.exchange_rate if counterpart.exchange_rate else 1.0
            sync_transaction_to_balances(db, counterpart.account_id, counterpart.date.date(), -(counterpart.amount * Decimal(str(counterpart_exchange)) * counterpart_multiplier))
            db.delete(counterpart)

    db.commit()
    return


# --- REIMBURSEMENTS ---
#
# Paying for other people, and being paid for. The single-entry model had no way
# to say "this left my account but wasn't my spending", so a shared dinner made
# the payer's budget look blown and the other person's look healthy. These three
# endpoints are the ledger's answer: one for the debt you take on when you front
# money, one for the debt you take on when somebody fronts it for you, and one
# for settling either.


def _reimbursement_category(db: Session, household_id: uuid.UUID) -> models.Category:
    """
    The system category settlements are filed under.

    Settling is a cash movement, not a purchase — the spending was recorded when
    the bill was paid. Filing it here keeps it out of the burn rate (the name is
    in ``SYSTEM_CATEGORY_NAMES``) so the same dinner is not charged twice.
    """
    category = (
        db.query(models.Category)
        .filter(
            models.Category.household_id == household_id,
            models.Category.name == models.SYSTEM_CATEGORY_REIMBURSEMENT,
        )
        .first()
    )
    if category is None:
        category = models.Category(
            id=uuid.uuid7(),
            household_id=household_id,
            name=models.SYSTEM_CATEGORY_REIMBURSEMENT,
            type="expense",
        )
        db.add(category)
        db.flush()
    return category


@router.get(
    "/reimbursements/household/{household_id}",
    response_model=List[schemas.CounterpartyBalanceResponse],
)
def get_counterparty_balances(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Who still owes the household money, and who it still owes."""
    verify_household_access(household_id, current_user, db)
    balances = ledger_service.counterparty_balances(db, household_id, current_user)
    return [
        schemas.CounterpartyBalanceResponse(
            counterparty_id=row.counterparty_id,
            counterparty_name=row.counterparty_name,
            direction=(
                schemas.CounterpartyDirection.owed_to_you
                if row.role == models.LedgerAccountRole.receivable
                else schemas.CounterpartyDirection.you_owe
            ),
            amount=row.amount,
            owner_user_id=row.owner_user_id,
        )
        for row in balances
    ]


@router.post(
    "/reimbursements/on-behalf",
    response_model=schemas.CounterpartyBalanceResponse,
    status_code=status.HTTP_201_CREATED,
)
def record_spend_on_your_behalf(
    payload: schemas.SpendOnYourBehalfCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Record that somebody else paid for something of yours.

    No account is involved because no account moved: this is the case single
    entry could not write down at all. The cost lands in your category, so your
    budget sees it, and the matching debt lands on their payable.
    """
    verify_household_access(payload.household_id, current_user, db)
    verify_private_owner_visibility(payload.owner_user_id, current_user)

    category = (
        db.query(models.Category)
        .filter(
            models.Category.id == payload.category_id,
            models.Category.household_id == payload.household_id,
        )
        .first()
    )
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    counterparty = _load_counterparty(db, payload.household_id, payload.counterparty_id)

    ledger_service.post_spend_on_your_behalf(
        db,
        household_id=payload.household_id,
        category=category,
        counterparty=counterparty,
        amount=payload.amount,
        date=payload.date,
        description=payload.description,
        owner_user_id=payload.owner_user_id,
    )
    db.commit()

    account = ledger_service.payable_account(
        db, payload.household_id, counterparty, payload.owner_user_id
    )
    return schemas.CounterpartyBalanceResponse(
        counterparty_id=counterparty.id,
        counterparty_name=counterparty.name,
        direction=schemas.CounterpartyDirection.you_owe,
        amount=ledger_service.account_balance(db, account.id),
        owner_user_id=payload.owner_user_id,
    )


@router.post(
    "/reimbursements/settle",
    response_model=schemas.TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def settle_with_counterparty(
    payload: schemas.SettlementCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Clear a debt in either direction.

    Real money moves, so this creates a real transaction and the account balance
    follows it. What it must not do is charge a category: the spending was
    recorded when the bill was paid, and charging it again here would double it.
    """
    account = (
        db.query(models.FinancialAccount)
        .filter(models.FinancialAccount.id == payload.account_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    verify_household_access(account.household_id, current_user, db)
    verify_private_owner_visibility(account.owner_user_id, current_user)
    verify_private_owner_visibility(payload.owner_user_id, current_user)

    counterparty = _load_counterparty(db, account.household_id, payload.counterparty_id)

    receiving = payload.direction == schemas.CounterpartyDirection.owed_to_you
    role = (
        models.LedgerAccountRole.receivable
        if receiving
        else models.LedgerAccountRole.payable
    )

    category = _reimbursement_category(db, account.household_id)
    home_currency = account.household.base_currency or "USD"
    account_currency = account.currency or "USD"
    rate_to_home = fetch_and_cache_exchange_rates(
        db, account_currency, home_currency, payload.date.date()
    )

    txn = models.Transaction(
        id=uuid.uuid7(),
        account_id=account.id,
        category_id=category.id,
        date=payload.date,
        amount=payload.amount,
        amount_home_currency=payload.amount * Decimal(str(rate_to_home)),
        currency=account_currency,
        exchange_rate=1.0,
        description=payload.description
        or (f"Repaid by {counterparty.name}" if receiving else f"Repaid {counterparty.name}"),
        # Direction of the cash, not of any spending: receiving a repayment adds
        # to the account, paying one back takes from it.
        transaction_type=(
            models.TransactionType.income if receiving else models.TransactionType.expense
        ),
    )
    db.add(txn)
    sync_transaction_to_balances(
        db,
        account.id,
        payload.date.date(),
        payload.amount if receiving else -payload.amount,
    )
    db.flush()

    ledger_service.post_settlement(
        db,
        transaction=txn,
        counterparty=counterparty,
        role=role,
        # The debt's own owner scope, not the settling account's — settling
        # through a different account (or a housemate's) must still clear the
        # same receivable/payable rather than opening a second one.
        owner_user_id=payload.owner_user_id,
    )
    db.commit()
    db.refresh(txn)
    return schemas.TransactionResponse.model_validate(txn)


# --- COUNTERPARTIES ---
#
# The reusable "who" behind a split, a settlement, or an on-your-behalf entry.
# Household-scoped and shared, like a Category — the name isn't sensitive, only
# the dollar amounts on a receivable are, and those keep inheriting privacy
# from the account they were posted against.


@router.post(
    "/counterparties", response_model=schemas.CounterpartyResponse, status_code=status.HTTP_201_CREATED
)
def create_counterparty(
    counterparty: schemas.CounterpartyCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(counterparty.household_id, current_user, db)

    existing = (
        db.query(models.Counterparty)
        .filter(
            models.Counterparty.household_id == counterparty.household_id,
            models.Counterparty.name == counterparty.name,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="A person with this name already exists")

    db_counterparty = models.Counterparty(
        id=uuid.uuid7(),
        household_id=counterparty.household_id,
        name=counterparty.name,
    )
    db.add(db_counterparty)
    db.commit()
    db.refresh(db_counterparty)
    return db_counterparty


@router.get(
    "/counterparties/household/{household_id}",
    response_model=List[schemas.CounterpartyResponse],
)
def get_household_counterparties(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(household_id, current_user, db)
    return (
        db.query(models.Counterparty)
        .filter(models.Counterparty.household_id == household_id)
        .order_by(models.Counterparty.name)
        .all()
    )


@router.put("/counterparties/{counterparty_id}", response_model=schemas.CounterpartyResponse)
def update_counterparty(
    counterparty_id: uuid.UUID,
    counterparty_update: schemas.CounterpartyUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_counterparty = db.query(models.Counterparty).filter(models.Counterparty.id == counterparty_id).first()
    if not db_counterparty:
        raise HTTPException(status_code=404, detail="Counterparty not found")

    verify_household_access(db_counterparty.household_id, current_user, db)

    duplicate = (
        db.query(models.Counterparty)
        .filter(
            models.Counterparty.household_id == db_counterparty.household_id,
            models.Counterparty.name == counterparty_update.name,
            models.Counterparty.id != counterparty_id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A person with this name already exists")

    # The point: renaming here updates every receivable/payable that already
    # points at this row's id, rather than minting a new ledger account.
    db_counterparty.name = counterparty_update.name
    db.commit()
    db.refresh(db_counterparty)
    return db_counterparty


@router.delete("/counterparties/{counterparty_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_counterparty(
    counterparty_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_counterparty = db.query(models.Counterparty).filter(models.Counterparty.id == counterparty_id).first()
    if not db_counterparty:
        raise HTTPException(status_code=404, detail="Counterparty not found")

    verify_household_access(db_counterparty.household_id, current_user, db)

    ledger_account_count = (
        db.query(models.LedgerAccount)
        .filter(models.LedgerAccount.counterparty_id == counterparty_id)
        .count()
    )
    if ledger_account_count:
        raise HTTPException(
            status_code=409,
            detail="This person still has split, settlement, or reimbursement history. They can't be deleted.",
        )

    db.delete(db_counterparty)
    db.commit()
    return


# --- CATEGORIES ---

@router.post(
    "/categories", response_model=schemas.CategoryResponse, status_code=status.HTTP_201_CREATED
)
def create_category(
    category: schemas.CategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(category.household_id, current_user, db)

    db_category = models.Category(
        id=uuid.uuid7(),
        household_id=category.household_id,
        name=category.name,
        type=category.type.value,
    )
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category

@router.get(
    "/categories/household/{household_id}",
    response_model=List[schemas.CategoryResponse],
)
def get_household_categories(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    categories = db.query(models.Category).filter(models.Category.household_id == household_id).all()
    return categories

@router.put("/categories/{category_id}", response_model=schemas.CategoryResponse)
def update_category(
    category_id: uuid.UUID,
    category_update: schemas.CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")

    verify_household_access(db_category.household_id, current_user, db)

    # System categories (Transfer, Balance Adjustment, ...) are found by exact
    # name everywhere they're used (ledger_account_for_category,
    # _reimbursement_category, the budget/burn-rate exclusions, ...). Renaming
    # or retyping one wouldn't move that plumbing — it would just make the
    # find-or-create sites create a fresh category under the canonical name
    # while this one keeps its history, silently splitting a category in two.
    if db_category.name in models.SYSTEM_CATEGORY_NAMES:
        raise HTTPException(
            status_code=409,
            detail=f"'{db_category.name}' is a system category and can't be renamed or retyped.",
        )

    update_data = category_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_category, key, value)

    db.commit()
    db.refresh(db_category)
    return db_category

@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")

    verify_household_access(db_category.household_id, current_user, db)

    if db_category.name in models.SYSTEM_CATEGORY_NAMES:
        raise HTTPException(
            status_code=409,
            detail=f"'{db_category.name}' is a system category the app manages itself and can't be deleted.",
        )

    # A recurring rule or budget pointing at this category would leave a
    # dangling reference; without this the FK raises a bare 500. Tell the user
    # what to remove first instead.
    rule_count = db.query(models.RecurringTransaction).filter(
        models.RecurringTransaction.category_id == category_id
    ).count()
    if rule_count:
        raise HTTPException(
            status_code=409,
            detail=f"{rule_count} recurring transaction(s) still use this category. Delete them first.",
        )

    budget_count = db.query(models.BudgetCategory).filter(models.BudgetCategory.category_id == category_id).count()
    if budget_count:
        raise HTTPException(
            status_code=409,
            detail="A budget still uses this category. Delete the budget first.",
        )

    db.delete(db_category)
    db.commit()
    return


# ---------------------------------------------------------------------------
# RECURRING TRANSACTIONS
#
# Salary, rent, subscriptions: things the user was previously retyping every
# month. A rule owns a `next_due_date`; posting advances it, which makes the
# whole thing idempotent and lets it catch up after the app has been idle.
# ---------------------------------------------------------------------------


def _load_rule_targets(
    db: Session,
    household_id: uuid.UUID,
    account_id: uuid.UUID,
    category_id: uuid.UUID,
    current_user: models.User,
):
    """Validate that the account and category exist, match the household, and are visible."""
    account = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.id == account_id
    ).first()
    if not account or account.household_id != household_id:
        raise HTTPException(status_code=404, detail="Account not found")
    verify_private_owner_visibility(account.owner_user_id, current_user)

    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category or category.household_id != household_id:
        raise HTTPException(status_code=404, detail="Category not found")
    if category.name in models.SYSTEM_CATEGORY_NAMES:
        # These are bookkeeping categories the app creates for itself (Transfer,
        # Balance Adjustment, ...) and are deliberately excluded from the
        # budget/burn-rate rollups. A recurring rule filed under one would
        # misclassify real spending and fight the balance-reconciliation logic
        # that owns it.
        raise HTTPException(
            status_code=400,
            detail=f"'{category.name}' is a system category and can't be used for a recurring transaction.",
        )

    return account, category


@router.post(
    "/recurring",
    response_model=schemas.RecurringTransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_recurring_transaction(
    payload: schemas.RecurringTransactionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(payload.household_id, current_user, db)
    _load_rule_targets(db, payload.household_id, payload.account_id, payload.category_id, current_user)

    if payload.end_date and payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    db_rule = models.RecurringTransaction(
        id=uuid.uuid7(),
        household_id=payload.household_id,
        account_id=payload.account_id,
        category_id=payload.category_id,
        amount=payload.amount,
        currency=payload.currency,
        description=payload.description,
        frequency=payload.frequency,
        start_date=payload.start_date,
        end_date=payload.end_date,
        # A rule starts owing its very first occurrence; back-dating the start
        # is how a user records something that has been running for a while,
        # and the next run will catch it up.
        next_due_date=payload.start_date,
        is_active=payload.is_active,
        owner_user_id=payload.owner_user_id,
    )
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)
    return db_rule


@router.get(
    "/recurring/household/{household_id}",
    response_model=List[schemas.RecurringTransactionResponse],
)
def get_household_recurring(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(household_id, current_user, db)
    return (
        db.query(models.RecurringTransaction)
        .filter(
            models.RecurringTransaction.household_id == household_id,
            (models.RecurringTransaction.owner_user_id.is_(None))
            | (models.RecurringTransaction.owner_user_id == current_user.id),
        )
        .order_by(models.RecurringTransaction.next_due_date)
        .all()
    )


@router.get(
    "/recurring/household/{household_id}/upcoming",
    response_model=List[schemas.UpcomingOccurrence],
)
def get_upcoming_occurrences(
    household_id: uuid.UUID,
    days: int = 60,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Everything the household's active rules will post in the next `days` days."""
    verify_household_access(household_id, current_user, db)

    if days < 1 or days > 730:
        raise HTTPException(status_code=400, detail="days must be between 1 and 730")

    rules = (
        db.query(models.RecurringTransaction)
        .filter(
            models.RecurringTransaction.household_id == household_id,
            models.RecurringTransaction.is_active.is_(True),
            (models.RecurringTransaction.owner_user_id.is_(None))
            | (models.RecurringTransaction.owner_user_id == current_user.id),
        )
        .all()
    )
    if not rules:
        return []

    accounts = {
        a.id: a
        for a in db.query(models.FinancialAccount).filter(
            models.FinancialAccount.household_id == household_id
        ).all()
    }
    categories = {
        c.id: c
        for c in db.query(models.Category).filter(models.Category.household_id == household_id).all()
    }

    until = datetime.now(timezone.utc).date() + timedelta(days=days)

    occurrences: List[schemas.UpcomingOccurrence] = []
    for rule in rules:
        account = accounts.get(rule.account_id)
        category = categories.get(rule.category_id)
        if not account or not category:
            continue
        # A rule on another member's private account must not surface here.
        if account.owner_user_id is not None and account.owner_user_id != current_user.id:
            continue

        for occurrence_date in recurring_service.upcoming_occurrences(rule, until=until):
            occurrences.append(
                schemas.UpcomingOccurrence(
                    recurring_transaction_id=rule.id,
                    description=rule.description,
                    category_name=category.name,
                    account_name=account.name,
                    date=occurrence_date,
                    amount=rule.amount,
                    currency=rule.currency or account.currency,
                    transaction_type=category.type,
                )
            )

    occurrences.sort(key=lambda o: o.date)
    return occurrences


@router.put(
    "/recurring/{recurring_id}", response_model=schemas.RecurringTransactionResponse
)
def update_recurring_transaction(
    recurring_id: uuid.UUID,
    payload: schemas.RecurringTransactionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_rule = db.query(models.RecurringTransaction).filter(
        models.RecurringTransaction.id == recurring_id
    ).first()
    if not db_rule:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")

    verify_household_access(db_rule.household_id, current_user, db)
    verify_private_owner_visibility(db_rule.owner_user_id, current_user)

    update_data = payload.model_dump(exclude_unset=True)

    if "account_id" in update_data or "category_id" in update_data:
        _load_rule_targets(
            db,
            db_rule.household_id,
            update_data.get("account_id", db_rule.account_id),
            update_data.get("category_id", db_rule.category_id),
            current_user,
        )

    for key, value in update_data.items():
        setattr(db_rule, key, value)

    if db_rule.end_date and db_rule.end_date < db_rule.start_date:
        raise HTTPException(status_code=400, detail="end_date cannot be before start_date")

    # Moving the start date re-anchors the schedule; anything already posted
    # stays posted, but the next due date has to land back on the new grid.
    if "start_date" in update_data and "next_due_date" not in update_data:
        if db_rule.last_posted_date:
            db_rule.next_due_date = recurring_service.next_occurrence(db_rule, db_rule.last_posted_date)
        else:
            db_rule.next_due_date = db_rule.start_date

    db.commit()
    db.refresh(db_rule)
    return db_rule


@router.delete("/recurring/{recurring_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring_transaction(
    recurring_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Delete the rule. Transactions it already posted are left alone — they are
    real history, and the FK is ON DELETE SET NULL.
    """
    db_rule = db.query(models.RecurringTransaction).filter(
        models.RecurringTransaction.id == recurring_id
    ).first()
    if not db_rule:
        raise HTTPException(status_code=404, detail="Recurring transaction not found")

    verify_household_access(db_rule.household_id, current_user, db)
    verify_private_owner_visibility(db_rule.owner_user_id, current_user)

    db.delete(db_rule)
    db.commit()
    return


@router.post(
    "/recurring/household/{household_id}/run",
    response_model=schemas.RecurringRunResponse,
)
def run_recurring_now(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Post everything that has come due. The daily job calls the same service, so
    this is really a "don't wait until tomorrow" button.
    """
    verify_household_access(household_id, current_user, db)
    posted = recurring_service.materialize_due(db, household_id)
    db.commit()
    return schemas.RecurringRunResponse(posted=posted)


# ---------------------------------------------------------------------------
# BUDGETS
# ---------------------------------------------------------------------------


@router.post(
    "/budgets", response_model=schemas.BudgetResponse, status_code=status.HTTP_201_CREATED
)
def create_budget(
    payload: schemas.BudgetCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(payload.household_id, current_user, db)

    categories = db.query(models.Category).filter(models.Category.id.in_(payload.category_ids)).all()
    found_ids = {c.id for c in categories}
    missing = set(payload.category_ids) - found_ids
    if missing or any(c.household_id != payload.household_id for c in categories):
        raise HTTPException(status_code=404, detail="Category not found")
    non_expense = [c.name for c in categories if c.type != models.TransactionType.expense.value]
    if non_expense:
        raise HTTPException(status_code=400, detail="Only expense categories can be budgeted")

    owner_filter = (
        models.BudgetCategory.owner_user_id.is_(None) if payload.owner_user_id is None
        else models.BudgetCategory.owner_user_id == payload.owner_user_id
    )
    conflicting = (
        db.query(models.Category.name)
        .join(models.BudgetCategory, models.BudgetCategory.category_id == models.Category.id)
        .filter(
            models.BudgetCategory.household_id == payload.household_id,
            models.BudgetCategory.category_id.in_(payload.category_ids),
            owner_filter,
        )
        .all()
    )
    if conflicting:
        names = ", ".join(sorted(c.name for c in conflicting))
        raise HTTPException(status_code=409, detail=f"A budget already exists for: {names}")

    db_budget = models.Budget(
        id=uuid.uuid7(),
        household_id=payload.household_id,
        amount=payload.amount,
        period=payload.period,
        owner_user_id=payload.owner_user_id,
    )
    db.add(db_budget)
    db.flush()
    for category_id in payload.category_ids:
        db.add(
            models.BudgetCategory(
                id=uuid.uuid7(),
                budget_id=db_budget.id,
                category_id=category_id,
                household_id=payload.household_id,
                owner_user_id=payload.owner_user_id,
            )
        )
    db.commit()
    db.refresh(db_budget)
    return db_budget


@router.get("/budgets/household/{household_id}", response_model=List[schemas.BudgetResponse])
def get_household_budgets(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    verify_household_access(household_id, current_user, db)
    return (
        db.query(models.Budget)
        .filter(
            models.Budget.household_id == household_id,
            (models.Budget.owner_user_id.is_(None))
            | (models.Budget.owner_user_id == current_user.id),
        )
        .all()
    )


@router.get(
    "/budgets/household/{household_id}/status",
    response_model=schemas.BudgetStatusResponse,
)
def get_budget_status(
    household_id: uuid.UUID,
    as_of: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Each budget with spend so far in its current period, and the end-of-period pace."""
    verify_household_access(household_id, current_user, db)

    household = db.query(models.Household).filter(models.Household.id == household_id).first()
    on = as_of or datetime.now(timezone.utc).date()

    statuses = budget_service.budget_statuses(db, household_id, current_user, on)

    rows = [
        schemas.BudgetStatusRow(
            budget_id=s.budget.id,
            category_ids=s.budget.category_ids,
            category_names=s.category_names,
            period=s.budget.period,
            is_private=s.budget.owner_user_id is not None,
            limit=s.limit,
            spent=s.spent,
            remaining=s.remaining,
            percent_used=s.percent_used,
            period_start=s.period_start,
            period_end=s.period_end,
            days_elapsed=s.days_elapsed,
            days_total=s.days_total,
            projected_spend=s.projected_spend,
            projected_over=s.projected_over,
        )
        for s in statuses
    ]

    return schemas.BudgetStatusResponse(
        household_id=household_id,
        base_currency=(household.base_currency if household else None) or "USD",
        as_of=on,
        total_limit=sum((r.limit for r in rows), Decimal("0")),
        total_spent=sum((r.spent for r in rows), Decimal("0")),
        budgets=rows,
    )


@router.put("/budgets/{budget_id}", response_model=schemas.BudgetResponse)
def update_budget(
    budget_id: uuid.UUID,
    payload: schemas.BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_budget = db.query(models.Budget).filter(models.Budget.id == budget_id).first()
    if not db_budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    verify_household_access(db_budget.household_id, current_user, db)
    verify_private_owner_visibility(db_budget.owner_user_id, current_user)

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(db_budget, key, value)

    db.commit()
    db.refresh(db_budget)
    return db_budget


@router.delete("/budgets/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(
    budget_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db_budget = db.query(models.Budget).filter(models.Budget.id == budget_id).first()
    if not db_budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    verify_household_access(db_budget.household_id, current_user, db)
    verify_private_owner_visibility(db_budget.owner_user_id, current_user)

    db.delete(db_budget)
    db.commit()
    return


# ---------------------------------------------------------------------------
# EMERGENCY FUND
# ---------------------------------------------------------------------------


@router.get(
    "/household/{household_id}/emergency-fund",
    response_model=schemas.EmergencyFundResponse,
)
def get_emergency_fund(
    household_id: uuid.UUID,
    as_of: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """How many months the household's liquid cash covers at its recent burn rate."""
    verify_household_access(household_id, current_user, db)

    household = db.query(models.Household).filter(models.Household.id == household_id).first()
    on = as_of or datetime.now(timezone.utc).date()

    result = budget_service.emergency_fund_status(db, household_id, current_user, on)

    return schemas.EmergencyFundResponse(
        household_id=household_id,
        base_currency=(household.base_currency if household else None) or "USD",
        as_of=on,
        liquid_total=result.liquid_total,
        average_monthly_expenses=result.average_monthly_expenses,
        months_covered=result.months_covered,
        target_months=result.target_months,
        target_amount=result.target_amount,
        shortfall=result.shortfall,
        months_of_history=result.months_of_history,
        on_track=result.on_track,
    )
