from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import uuid

from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access, verify_private_owner_visibility
from src.services.account_service import sync_transaction_to_balances
from src.services.market_data import fetch_and_cache_exchange_rates
from src.services.transaction_service import create_transaction
from src.services import recurring_service, budget_service

router = APIRouter(prefix="/cashflow", tags=["Income & Expenses"])

# --- TRANSACTIONS ---

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
    )

    db.commit()
    db.refresh(db_transaction)
    return db_transaction

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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    # Get all accounts for this household
    accounts = db.query(models.FinancialAccount).filter(models.FinancialAccount.household_id == household_id).all()
    account_ids = [account.id for account in accounts]

    if not account_ids:
        return []

    transactions = db.query(models.Transaction).filter(models.Transaction.account_id.in_(account_ids)).all()
    return transactions

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
    for key, value in update_data.items():
        setattr(db_transaction, key, value)

    # Recalculate amount_home_currency if needed
    if any(k in update_data for k in ('amount', 'currency', 'date', 'account_id')):
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

    db.commit()
    db.refresh(db_transaction)
    return db_transaction

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

    budget_count = db.query(models.Budget).filter(models.Budget.category_id == category_id).count()
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

    category = db.query(models.Category).filter(models.Category.id == payload.category_id).first()
    if not category or category.household_id != payload.household_id:
        raise HTTPException(status_code=404, detail="Category not found")
    if category.type != models.TransactionType.expense.value:
        raise HTTPException(status_code=400, detail="Only expense categories can be budgeted")

    existing = db.query(models.Budget).filter(
        models.Budget.household_id == payload.household_id,
        models.Budget.category_id == payload.category_id,
        models.Budget.owner_user_id.is_(None) if payload.owner_user_id is None
        else models.Budget.owner_user_id == payload.owner_user_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A budget already exists for this category")

    db_budget = models.Budget(
        id=uuid.uuid7(),
        household_id=payload.household_id,
        category_id=payload.category_id,
        amount=payload.amount,
        period=payload.period,
        owner_user_id=payload.owner_user_id,
    )
    db.add(db_budget)
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
            category_id=s.budget.category_id,
            category_name=s.category_name,
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
