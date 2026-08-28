from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from src.database import get_db
from src import schemas, models
from src.auth import get_current_user, verify_household_access, verify_private_owner_visibility
from src.services.account_service import propagate_balance_change, sync_transaction_to_balances
from src.services.market_data import fetch_and_cache_exchange_rates
from src.services import ledger_service, loan_service
from src.services.snapshot_engine import run_snapshot_range
from sqlalchemy import desc, func, select
from decimal import Decimal
from datetime import date, datetime, timezone
import uuid

router = APIRouter(prefix="/accounts", tags=["Financial Accounts"])


def _verify_linkable_account(
    db: Session,
    linked_account_id: uuid.UUID,
    household_id: uuid.UUID,
    current_user: models.User,
):
    """
    A property/loan link may only point at an account in the same household that
    the caller can actually see — otherwise the link leaks the existence (and,
    via the equity endpoint, the balance) of another member's private account.
    """
    target = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.id == linked_account_id
    ).first()
    if not target or target.household_id != household_id:
        raise HTTPException(status_code=404, detail="Linked account not found")
    verify_private_owner_visibility(target.owner_user_id, current_user)
    return target


def _verify_linkable_sub_portfolio(
    db: Session,
    sub_portfolio_id: uuid.UUID,
    household_id: uuid.UUID,
    current_user: models.User,
):
    """
    Earmarking an account to a sub-portfolio (#252) is subject to the same two
    rules as a property/loan link: same household, and the caller must be able to
    see the target. Without the visibility check, linking to another member's
    private goal would surface that goal's existence and let this account's
    balance be read out of its value.
    """
    target = db.query(models.SubPortfolio).filter(
        models.SubPortfolio.id == sub_portfolio_id
    ).first()
    if not target or target.household_id != household_id:
        raise HTTPException(status_code=404, detail="Sub-portfolio not found")
    verify_private_owner_visibility(target.owner_user_id, current_user)
    return target


@router.post("", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    account: schemas.AccountCreate, 
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Verify that the current user has access to the household
    verify_household_access(account.household_id, current_user, db)
    
    if account.linked_account_id:
        _verify_linkable_account(db, account.linked_account_id, account.household_id, current_user)

    if account.sub_portfolio_id:
        _verify_linkable_sub_portfolio(db, account.sub_portfolio_id, account.household_id, current_user)

    db_account = models.FinancialAccount(
        id=uuid.uuid7(),
        household_id=account.household_id,
        name=account.name,
        liquidity=account.liquidity,
        tax_status=account.tax_status,
        kind=account.kind,
        currency=account.currency,
        owner_user_id=account.owner_user_id,
        original_principal=account.original_principal,
        interest_rate_annual=account.interest_rate_annual,
        loan_term_months=account.loan_term_months,
        monthly_payment=account.monthly_payment,
        loan_start_date=account.loan_start_date,
        appreciation_rate_annual=account.appreciation_rate_annual,
        linked_account_id=account.linked_account_id,
        sub_portfolio_id=account.sub_portfolio_id,
    )
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account


@router.get("/household/{household_id}", response_model=List[schemas.AccountResponse])
def get_household_accounts(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)
    # Shared accounts (owner_user_id is NULL) are visible to the whole household;
    # private accounts are only visible to their owner.
    accounts = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.household_id == household_id,
        (models.FinancialAccount.owner_user_id.is_(None)) | (models.FinancialAccount.owner_user_id == current_user.id)
    ).all()
    return accounts


@router.put("/{account_id}", response_model=schemas.AccountResponse)
def update_account(
    account_id: uuid.UUID,
    account_update: schemas.AccountUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    update_data = account_update.model_dump(exclude_unset=True)

    linked_id = update_data.get("linked_account_id")
    if linked_id:
        if linked_id == account_id:
            raise HTTPException(status_code=400, detail="An account cannot be linked to itself")
        _verify_linkable_account(db, linked_id, db_account.household_id, current_user)

    sub_portfolio_changed = (
        "sub_portfolio_id" in update_data
        and update_data["sub_portfolio_id"] != db_account.sub_portfolio_id
    )
    if sub_portfolio_changed and update_data["sub_portfolio_id"]:
        _verify_linkable_sub_portfolio(
            db, update_data["sub_portfolio_id"], db_account.household_id, current_user
        )

    for key, value in update_data.items():
        setattr(db_account, key, value)

    db.commit()
    db.refresh(db_account)

    # Earmarking (or un-earmarking) rewrites this account's contribution to a
    # sub-portfolio's whole history, so replay from its first recorded balance
    # rather than from today — otherwise the goal's equity curve would start at
    # the link date and read as though the money appeared out of nowhere. The
    # rebuild also purges the old rows on unlink, since run_snapshot_range clears
    # the range before rewriting it.
    if sub_portfolio_changed:
        first_balance_date = db.query(func.min(models.AccountBalance.date)).filter(
            models.AccountBalance.account_id == account_id
        ).scalar()
        run_snapshot_range(
            db, db_account.household_id, first_balance_date or date.today(), date.today()
        )

    return db_account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    # Recurring rules reference the account; deleting out from under them would
    # trip the FK and surface as a 500. Say what needs removing first.
    rule_count = db.query(models.RecurringTransaction).filter(
        models.RecurringTransaction.account_id == account_id
    ).count()
    if rule_count:
        raise HTTPException(
            status_code=409,
            detail=f"{rule_count} recurring transaction(s) still use this account. Delete them first.",
        )

    # An earmarked account leaves snapshot rows behind in its sub-portfolio (#252).
    # Capture what's needed to rebuild before the row is gone, then replay: the
    # replay clears the range and simply won't re-emit rows for an account that no
    # longer exists, so the goal stops counting money that isn't there.
    was_earmarked = db_account.sub_portfolio_id is not None
    household_id = db_account.household_id
    first_balance_date = db.query(func.min(models.AccountBalance.date)).filter(
        models.AccountBalance.account_id == account_id
    ).scalar() if was_earmarked else None

    db.delete(db_account)
    db.commit()

    if was_earmarked:
        run_snapshot_range(db, household_id, first_balance_date or date.today(), date.today())
    return


@router.post("/accountaccess", response_model=schemas.AccountAccessResponse, status_code=status.HTTP_201_CREATED)
def grant_account_access(
    access: schemas.AccountAccessCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == access.account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

    db_access = models.AccountAccess(
        id=access.id if access.id else uuid.uuid7(),
        account_id=access.account_id,
        user_id=access.user_id,
        role=access.role,
    )
    db.add(db_access)
    db.commit()
    db.refresh(db_access)
    return db_access


@router.get(
    "/accountaccess/{account_id}", response_model=List[schemas.AccountAccessResponse]
)
def get_account_access_list(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)

    access_list = db.query(models.AccountAccess).filter(models.AccountAccess.account_id == account_id).all()
    return access_list


@router.put("/accountaccess/{access_id}", response_model=schemas.AccountAccessResponse)
def update_account_access(
    access_id: uuid.UUID,
    access_update: schemas.AccountAccessUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_access = db.query(models.AccountAccess).filter(models.AccountAccess.id == access_id).first()
    if not db_access:
        raise HTTPException(status_code=404, detail="Account access not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_access.account_id).first()
    verify_household_access(db_account.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

    if access_update.role:
        db_access.role = access_update.role

    db.commit()
    db.refresh(db_access)
    return db_access


@router.delete("/accountaccess/{access_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_account_access(
    access_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_access = db.query(models.AccountAccess).filter(models.AccountAccess.id == access_id).first()
    if not db_access:
        raise HTTPException(status_code=404, detail="Account access not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_access.account_id).first()
    verify_household_access(db_account.household_id, current_user, db, required_roles=[models.HouseholdRoleType.owner, models.HouseholdRoleType.editor])

    db.delete(db_access)
    db.commit()
    return


@router.post("/balances", response_model=schemas.BalanceResponse, status_code=status.HTTP_201_CREATED)
def add_account_balance(
    balance: schemas.BalanceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == balance.account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    # Check if a balance already exists for this date
    db_balance = db.query(models.AccountBalance).filter(
        models.AccountBalance.account_id == balance.account_id,
        models.AccountBalance.date == balance.date
    ).first()

    # An account's *first* balance is an opening balance, not a reconciliation,
    # and the difference matters: `is_manual` marks a checkpoint that
    # `propagate_balance_change` refuses to move through. A reconciliation should
    # be a checkpoint — it says "I counted, and it was this much on this date",
    # which a later-entered transaction must not silently overwrite. An opening
    # balance asserts nothing of the kind. There is no history behind it to
    # correct, so there is nothing for it to be a checkpoint *against*.
    #
    # Marking it manual made every new account plant an anchor at its creation
    # date, so a transaction entered with an earlier date — a purchase from last
    # week, on a card you just set up — updated its own day and then stopped
    # dead, leaving the headline balance reading zero forever.
    others = db.query(models.AccountBalance.id).filter(
        models.AccountBalance.account_id == balance.account_id
    )
    if db_balance:
        others = others.filter(models.AccountBalance.id != db_balance.id)
    is_opening_balance = others.first() is None

    # Calculate delta for propagation if there's already a balance chain
    # What would the balance have been on this date?
    if db_balance:
        expected_balance = db_balance.balance
    else:
        prev_balance_rec = db.query(models.AccountBalance).filter(
            models.AccountBalance.account_id == balance.account_id,
            models.AccountBalance.date < balance.date
        ).order_by(desc(models.AccountBalance.date)).first()
        expected_balance = prev_balance_rec.balance if prev_balance_rec else Decimal("0")
    
    delta = balance.balance - expected_balance

    # Handle Currency Conversion for manual balance
    home_curr = db.query(models.Household).filter(models.Household.id == db_account.household_id).first().base_currency or "USD"
    acc_curr = db_account.currency or "USD"
    rate = fetch_and_cache_exchange_rates(db, acc_curr, home_curr, balance.date)

    if db_balance:
        db_balance.balance = balance.balance
        db_balance.balance_home_currency = float(balance.balance) * rate
        # Editing the opening balance leaves it an opening balance.
        db_balance.is_manual = not is_opening_balance
    else:
        db_balance = models.AccountBalance(
            id=uuid.uuid7(),
            account_id=balance.account_id,
            date=balance.date,
            balance=balance.balance,
            balance_home_currency=float(balance.balance) * rate,
            is_manual=not is_opening_balance,
        )
        db.add(db_balance)
    
    db.flush()

    # If there's a difference, create a reconciliation transaction
    if delta != 0:
        # Find or create "Adjustment" category
        adjustment_cat = db.query(models.Category).filter(
            models.Category.household_id == db_account.household_id,
            models.Category.name == models.SYSTEM_CATEGORY_BALANCE_ADJUSTMENT
        ).first()
        
        if not adjustment_cat:
            adjustment_cat = models.Category(
                id=uuid.uuid7(),
                household_id=db_account.household_id,
                name=models.SYSTEM_CATEGORY_BALANCE_ADJUSTMENT,
                type=models.TransactionType.income.value if delta > 0 else models.TransactionType.expense.value
            )
            db.add(adjustment_cat)
            db.flush()
        
        # Create transaction
        # Convert date to datetime for the Transaction model
        trans_datetime = datetime.combine(balance.date, datetime.min.time()).replace(tzinfo=timezone.utc)
        
        adj_transaction = models.Transaction(
            id=uuid.uuid7(),
            account_id=balance.account_id,
            category_id=adjustment_cat.id,
            date=trans_datetime,
            amount=abs(delta),
            # Recorded in the account's own currency, so it needs the home-currency
            # equivalent like every other row — the budget rollups read
            # `amount_home_currency` and fall back to the raw amount, which for a
            # foreign-currency account is a different number wearing the same label.
            amount_home_currency=abs(delta) * Decimal(str(rate)),
            currency=acc_curr,
            exchange_rate=1.0,
            description=f"Automated reconciliation for {balance.date}",
            transaction_type=models.TransactionType.income if delta > 0 else models.TransactionType.expense
        )
        db.add(adj_transaction)
        db.flush()

        # A reconciliation asserts "this account really holds X" without saying
        # where the difference came from. Single entry could just move the number;
        # a ledger has to put the other side somewhere, and an equity plug is
        # where the unexplained belongs — kept in its own account so a
        # reconciliation stays visible as a reconciliation instead of hiding
        # inside real spending.
        ledger_service.post_balance_adjustment(
            db, account=db_account, transaction=adj_transaction, delta_home=Decimal(str(delta)) * Decimal(str(rate))
        )
    
    # Propagate the "correction" forward through automated records
    propagate_balance_change(db, balance.account_id, balance.date, delta)

    db.commit()
    db.refresh(db_balance)

    # An earmarked account's balance *is* part of its sub-portfolio's value (#252),
    # so recording one has to refresh the snapshots the goal reads from. Skipped
    # entirely for ordinary accounts, which the portfolio doesn't look at — this is
    # the app's hottest write path and a snapshot replay is not cheap.
    if db_account.sub_portfolio_id:
        run_snapshot_range(db, db_account.household_id, balance.date, date.today())

    return db_balance


@router.get(
    "/balances/household/{household_id}", response_model=List[schemas.BalanceResponse]
)
def get_household_balances(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    accounts = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.household_id == household_id,
        (models.FinancialAccount.owner_user_id.is_(None)) | (models.FinancialAccount.owner_user_id == current_user.id)
    ).all()
    account_ids = [account.id for account in accounts]

    if not account_ids:
        return []

    balances = db.query(models.AccountBalance).filter(models.AccountBalance.account_id.in_(account_ids)).all()
    return balances


@router.get(
    "/balances/account/{account_id}", response_model=List[schemas.BalanceResponse]
)
def get_account_balances(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    balances = db.query(models.AccountBalance).filter(models.AccountBalance.account_id == account_id).all()
    return balances


@router.put("/balances/{balance_id}", response_model=schemas.BalanceResponse)
def update_account_balance(
    balance_id: uuid.UUID,
    balance_update: schemas.BalanceUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_balance = db.query(models.AccountBalance).filter(models.AccountBalance.id == balance_id).first()
    if not db_balance:
        raise HTTPException(status_code=404, detail="Balance not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_balance.account_id).first()
    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    update_data = balance_update.model_dump(exclude_unset=True)
    
    if 'balance' in update_data:
        delta = Decimal(str(update_data['balance'])) - db_balance.balance
        propagate_balance_change(db, db_balance.account_id, db_balance.date, delta)
        db_balance.balance = Decimal(str(update_data['balance']))

        # Update home currency balance
        home_curr = db.query(models.Household).filter(models.Household.id == db_account.household_id).first().base_currency or "USD"
        acc_curr = db_account.currency or "USD"
        rate = fetch_and_cache_exchange_rates(db, acc_curr, home_curr, db_balance.date)
        db_balance.balance_home_currency = float(update_data['balance']) * rate

    for key, value in update_data.items():
        if key != 'balance': # already handled
            setattr(db_balance, key, value)

    db.commit()
    db.refresh(db_balance)
    return db_balance


@router.delete("/balances/{balance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account_balance(
    balance_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_balance = db.query(models.AccountBalance).filter(models.AccountBalance.id == balance_id).first()
    if not db_balance:
        raise HTTPException(status_code=404, detail="Balance not found")

    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == db_balance.account_id).first()
    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    if db_balance.is_manual:
        # 1. Find the reconciliation transaction
        adj_transaction = db.query(models.Transaction).filter(
            models.Transaction.account_id == db_balance.account_id,
            func.date(models.Transaction.date) == db_balance.date,
            models.Transaction.description == f"Automated reconciliation for {db_balance.date}"
        ).first()

        if adj_transaction:
            # 2. Calculate the delta that was introduced
            delta = adj_transaction.amount if adj_transaction.transaction_type == models.TransactionType.income else -adj_transaction.amount
            
            # 3. Propagate the negative delta forward
            propagate_balance_change(db, db_balance.account_id, db_balance.date, -delta)
            
            # 4. Delete the transaction
            db.delete(adj_transaction)

    # 5. Delete the balance record
    db.delete(db_balance)
    db.commit()
    return


# ---------------------------------------------------------------------------
# Loan amortization & net worth projection
#
# A mortgage recorded as a plain liability makes net worth read like a
# catastrophe: the debt is there in full, the house it bought is not, and the
# balance only falls when the user remembers to retype it. These two endpoints
# close that gap — one shows where a single loan is headed, the other walks the
# whole household forward so the user can see when they stop being underwater.
# ---------------------------------------------------------------------------


@router.get("/{account_id}/loan-schedule", response_model=schemas.LoanScheduleResponse)
def get_loan_schedule(
    account_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_account = db.query(models.FinancialAccount).filter(models.FinancialAccount.id == account_id).first()
    if not db_account:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_household_access(db_account.household_id, current_user, db)
    verify_private_owner_visibility(db_account.owner_user_id, current_user)

    terms = loan_service.loan_terms_for(db_account)
    if not terms:
        raise HTTPException(
            status_code=400,
            detail="Account has no loan terms. Set principal, interest rate, term and start date.",
        )

    schedule = loan_service.amortization_schedule(terms)
    today = datetime.now(timezone.utc).date()

    total_interest = sum((row.interest for row in schedule), Decimal("0"))
    interest_paid = sum((row.interest for row in schedule if row.date <= today), Decimal("0"))
    current_balance = loan_service.projected_loan_balance(terms, today)

    return schemas.LoanScheduleResponse(
        account_id=db_account.id,
        account_name=db_account.name,
        currency=db_account.currency or "USD",
        original_principal=terms.principal,
        interest_rate_annual=terms.annual_rate_percent,
        loan_term_months=terms.term_months,
        monthly_payment=terms.payment,
        loan_start_date=terms.start_date,
        payoff_date=loan_service.payoff_date(terms),
        current_balance=current_balance,
        principal_paid=terms.principal - current_balance,
        interest_paid=interest_paid,
        total_interest=total_interest,
        remaining_interest=total_interest - interest_paid,
        schedule=[
            schemas.AmortizationRow(
                period=row.period,
                date=row.date,
                payment=row.payment,
                interest=row.interest,
                principal=row.principal,
                balance=row.balance,
            )
            for row in schedule
        ],
    )


@router.get(
    "/household/{household_id}/projection",
    response_model=schemas.NetWorthProjectionResponse,
)
def get_net_worth_projection(
    household_id: uuid.UUID,
    months: int = 360,
    monthly_contribution: Decimal = Decimal("0"),
    portfolio_growth_rate_annual: Decimal = Decimal("0"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    verify_household_access(household_id, current_user, db)

    if months < 1 or months > 720:
        raise HTTPException(status_code=400, detail="months must be between 1 and 720")
    if monthly_contribution < 0:
        raise HTTPException(status_code=400, detail="monthly_contribution cannot be negative")
    if not (-100 <= portfolio_growth_rate_annual <= 100):
        raise HTTPException(
            status_code=400, detail="portfolio_growth_rate_annual must be between -100 and 100"
        )

    household = db.query(models.Household).filter(models.Household.id == household_id).first()

    accounts = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.household_id == household_id,
        (models.FinancialAccount.owner_user_id.is_(None)) | (models.FinancialAccount.owner_user_id == current_user.id)
    ).all()

    portfolio_value = _visible_portfolio_value(db, household_id, current_user)

    today = datetime.now(timezone.utc).date()
    projection = loan_service.project_household_net_worth(
        db,
        household_id,
        accounts,
        start=today,
        months=months,
        monthly_contribution=monthly_contribution,
        portfolio_value=portfolio_value,
        portfolio_growth_rate_annual=portfolio_growth_rate_annual,
    )

    return schemas.NetWorthProjectionResponse(
        household_id=household_id,
        base_currency=(household.base_currency if household else None) or "USD",
        start=today,
        months=months,
        current_net_worth=projection.points[0].net_worth if projection.points else Decimal("0"),
        net_worth_positive_date=projection.net_worth_positive_date,
        debt_free_date=projection.debt_free_date,
        total_interest_remaining=projection.total_interest_remaining,
        points=[
            schemas.NetWorthProjectionPoint(
                date=p.date, assets=p.assets, liabilities=p.liabilities, net_worth=p.net_worth
            )
            for p in projection.points
        ],
    )


@router.get(
    "/household/{household_id}/equity", response_model=List[schemas.LinkedEquityRow]
)
def get_linked_equity(
    household_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Every property (illiquid asset) netted against the loan secured on it.

    The link may be recorded on either side, so both directions are resolved
    here; a property with no loan simply reports its full value as equity.
    """
    verify_household_access(household_id, current_user, db)

    accounts = db.query(models.FinancialAccount).filter(
        models.FinancialAccount.household_id == household_id,
        (models.FinancialAccount.owner_user_id.is_(None)) | (models.FinancialAccount.owner_user_id == current_user.id)
    ).all()
    by_id = {a.id: a for a in accounts}

    balances = _latest_balances_by_account(db, list(by_id.keys()))

    # A mortgage may name the property instead of the other way round.
    loan_for_property = {}
    for acc in accounts:
        if acc.kind == models.AccountKind.liability and acc.linked_account_id in by_id:
            loan_for_property.setdefault(acc.linked_account_id, acc)

    rows: List[schemas.LinkedEquityRow] = []
    for acc in accounts:
        if acc.kind == models.AccountKind.liability or acc.liquidity != models.LiquidityStatus.illiquid:
            continue

        loan = None
        if acc.linked_account_id and acc.linked_account_id in by_id:
            candidate = by_id[acc.linked_account_id]
            if candidate.kind == models.AccountKind.liability:
                loan = candidate
        if loan is None:
            loan = loan_for_property.get(acc.id)

        asset_value = balances.get(acc.id, Decimal("0"))
        loan_balance = balances.get(loan.id, Decimal("0")) if loan else Decimal("0")
        equity = asset_value - loan_balance

        rows.append(
            schemas.LinkedEquityRow(
                asset_account_id=acc.id,
                asset_account_name=acc.name,
                asset_value=asset_value,
                loan_account_id=loan.id if loan else None,
                loan_account_name=loan.name if loan else None,
                loan_balance=loan_balance,
                equity=equity,
                equity_percent=float(equity / asset_value * 100) if asset_value else None,
            )
        )

    rows.sort(key=lambda r: r.asset_account_name)
    return rows


def _latest_balances_by_account(db: Session, account_ids: List[uuid.UUID]):
    """Latest home-currency balance per account, keyed by account id."""
    result = {}
    if not account_ids:
        return result
    rows = (
        db.query(models.AccountBalance)
        .filter(models.AccountBalance.account_id.in_(account_ids))
        .order_by(models.AccountBalance.date)
        .all()
    )
    for row in rows:
        value = row.balance_home_currency if row.balance_home_currency is not None else row.balance
        result[row.account_id] = Decimal(str(value)) if value is not None else Decimal("0")
    return result


def _visible_portfolio_value(db: Session, household_id: uuid.UUID, current_user: models.User) -> Decimal:
    """Latest snapshot value across the sub-portfolios this user can see."""
    sub_portfolio_ids = [
        sp.id
        for sp in db.query(models.SubPortfolio).filter(
            models.SubPortfolio.household_id == household_id,
            (models.SubPortfolio.owner_user_id.is_(None)) | (models.SubPortfolio.owner_user_id == current_user.id),
        ).all()
    ]
    if not sub_portfolio_ids:
        return Decimal("0")

    # A sold-to-zero holding stops getting new snapshot rows (see
    # snapshot_engine.run_snapshot_range), so different (sub_portfolio_id,
    # asset_id) pairs can have different "latest" dates — we can't just filter
    # to a single MAX(date). DISTINCT ON picks the newest row per pair without
    # pulling the household's entire snapshot history into Python first, which
    # otherwise grows unboundedly with account age.
    latest_snapshots = db.execute(
        select(models.PortfolioSnapshot)
        .where(models.PortfolioSnapshot.sub_portfolio_id.in_(sub_portfolio_ids))
        .distinct(models.PortfolioSnapshot.sub_portfolio_id, models.PortfolioSnapshot.asset_id)
        .order_by(
            models.PortfolioSnapshot.sub_portfolio_id,
            models.PortfolioSnapshot.asset_id,
            models.PortfolioSnapshot.date.desc(),
        )
    ).scalars().all()

    total = Decimal("0")
    for s in latest_snapshots:
        if s.current_value_home_currency is not None:
            total += Decimal(str(s.current_value_home_currency))
    return total
