from fastapi import APIRouter, Depends
from functools import lru_cache
from typing import List, Dict
import iso18245
import pycountry
from sqlalchemy.orm import Session
from src.database import get_db
from src import schemas

router = APIRouter(prefix="/reference", tags=["Reference Data"])

@router.get("/currencies", response_model=List[Dict[str, str]])
def get_currencies():
    """
    Returns a list of all official ISO 4217 currencies.
    """
    currencies = []
    for c in pycountry.currencies:
        # Some currencies might not have a name or alpha_3
        if hasattr(c, 'alpha_3') and hasattr(c, 'name'):
            currencies.append({
                "code": c.alpha_3,
                "name": c.name,
                "symbol": getattr(c, 'symbol', c.alpha_3)
            })
    return sorted(currencies, key=lambda x: x['code'])

@router.get("/countries", response_model=List[Dict[str, str]])
def get_countries():
    """
    Returns a list of all official ISO 3166 countries.
    """
    countries = []
    for c in pycountry.countries:
        countries.append({
            "code": c.alpha_2,
            "name": c.name
        })
    return sorted(countries, key=lambda x: x['name'])

@router.get("/exchange_rate")
def get_exchange_rate(base: str, target: str, date: str, db: Session = Depends(get_db)):
    """
    Fetch the exchange rate for a given base and target currency on a specific date.
    """
    from datetime import datetime
    from src.services.market_data import fetch_and_cache_exchange_rates
    
    target_date = datetime.strptime(date, "%Y-%m-%d").date()
    rate = fetch_and_cache_exchange_rates(db, base, target, target_date)
    return {"rate": rate}

@router.get("/timezones", response_model=List[Dict[str, str]])
def get_timezones():
    """
    Returns a list of all common timezones with their GMT offsets using pytz.
    """
    import pytz
    from datetime import datetime
    
    timezones = []
    now = datetime.now()
    for tz_name in pytz.common_timezones:
        tz = pytz.timezone(tz_name)
        offset = tz.utcoffset(now)
        offset_hours = int(offset.total_seconds() / 3600)
        offset_minutes = int((offset.total_seconds() % 3600) / 60)
        offset_str = f"GMT{'+' if offset_hours >= 0 else ''}{offset_hours:02d}:{abs(offset_minutes):02d}"
        timezones.append({
            "name": tz_name,
            "label": f"{tz_name} ({offset_str})"
        })
    return sorted(timezones, key=lambda x: x['name'])


# The 3000–3999 band is "reserved for private use" in ISO's own words, but in
# practice acquirers fill it with airline, hotel and car-rental *brands* — 3000 is
# United Airlines, 3501 is Holiday Inn Express. Labelling it by what it actually
# holds is more use to someone scrolling a picker than repeating "reserved".
_BRAND_RANGE_START = "3000"
_BRAND_GROUP = "Airline, hotel and car rental brands"

# iso18245's three sources (Stripe, USDA, ISO) predate a small set of codes the
# card networks have since put into real use, so those codes carry no
# description from any of them and would otherwise be dropped. This is not a
# general-purpose gap-filler: it names only codes confirmed live in Visa's or
# Mastercard's own current public MCC manuals (Visa's April 2026 Merchant Data
# Standards Manual; Mastercard's Quick Reference Booklet, June 2026 — 5262 is
# the one a user actually hit missing). Checked every code either manual
# defines against the full catalogue below: the unclaimed 3000-3999 brand
# slots and 7013/7280/7295/8912/9400 are in neither manual and are genuinely
# unassigned today, so they stay dropped rather than guessed at. One gap
# neither manual can fix: 5723 (Guns and Ammunition Shops, Visa-only) isn't in
# iso18245's range tables at all, not merely blank, so there's no row here to
# attach a name to.
_DESCRIPTION_OVERRIDES: Dict[str, str] = {
    "4813": "Key-entry Telecom Merchant providing single local and long-distance "
    "phone calls using a central access number in a non-face-to-face "
    "environment using key entry",
    "5262": "Marketplaces",
    "5552": "Electric Vehicle Charging",
    "6050": "Quasi Cash – Customer Financial Institution",
    "6532": "Payment Transaction – Customer Financial Institution",
    "6533": "Payment Transaction – Merchant",
    "6536": "MoneySend Intracountry",
    "6537": "MoneySend Intercountry",
    "6538": "MoneySend Funding",
    "7800": "Government-Owned Lotteries (US Region Only)",
    "7801": "Government Licensed On-Line Casinos (On-Line Gambling) (US Region Only)",
    "7802": "Government-Licensed Horse/Dog Racing (US Region Only)",
    "9406": "Government-Owned Lotteries (Non-U.S. Region)",
}

# The 3000-3999 band is "reserved for private use", so each network keeps its
# own brand assignments rather than sharing one canonical table — iso18245's
# ~400 brand names come from Stripe's list, which agrees with Mastercard's own
# published table wherever the two overlap, but doesn't carry all of it. These
# 187 are real Mastercard brand assignments — airlines (Emirates, EgyptAir,
# JetBlue), rental agencies and hotel chains — that were sitting blank.
# Sourced from Mastercard's Quick Reference Booklet's own alphabetic and
# Transaction Category Code tables, which agree with each other on every one
# of these codes. Uppercased to match the existing iso18245-sourced brand rows
# (`"UNITED AIRLINES"`, not `"United Airlines"`).
_BRAND_NAME_OVERRIDES: Dict[str, str] = {
    "3003": "EUROFLY",
    "3026": "EMIRATES AIRLINES",
    "3037": "EGYPTAIR",
    "3059": "DBA AIRLINES",
    "3064": "ADRIA AIRWAYS",
    "3067": "VANGUARD AIRLINES",
    "3068": "AIR ASTANA",
    "3069": "SUN COUNTRY AIRLINES",
    "3072": "CEBU PACIFIC",
    "3076": "AEROMEXICO",
    "3079": "JETSTAR AIRWAYS",
    "3090": "UNI AIRWAYS",
    "3097": "SPANAIR",
    "3098": "ASIANA AIRLINES",
    "3131": "VLM AIRLINES",
    "3132": "FRONTIER AIRLINES",
    "3136": "QATAR AIRWAYS COMPANY W.L.L.",
    "3148": "AIR LITTORAL, S.A.",
    "3156": "GO FLY LTD.",
    "3167": "AERO CONTINENTE",
    "3174": "JETBLUE AIRWAYS",
    "3175": "MIDDLE EAST AIR",
    "3177": "AIRTRAN AIRWAYS",
    "3180": "WESTJET AIRLINES",
    "3183": "OMAN AVIATION SERVICES",
    "3188": "VIRGIN EXPRESS",
    "3206": "CHINA EASTERN AIRLINES",
    "3211": "NORWEGIAN AIR SHUTTLE",
    "3213": "MALMO AVIATION",
    "3226": "SKYWAYS",
    "3236": "AIR ARABIA AIRLINE",
    "3245": "EASYJET",
    "3246": "RYANAIR",
    "3247": "GOL AIRLINES",
    "3248": "TAM AIRLINES",
    "3260": "SPIRIT AIRLINES",
    "3263": "AERO SERVICIO CARABOBO",
    "3296": "AIR BERLIN",
    "3297": "TAROM ROMANIAN AIR TRANSPORT",
    "3300": "AZUL BRAZILIAN AIRLINES",
    "3301": "WIZZ AIRLINES",
    "3355": "SIXT CAR RENTAL",
    "3374": "ACCENT RENT-A-CAR",
    "3376": "AJAX RENT-A-CAR",
    "3380": "TRIANGLE RENT-A-CAR",
    "3388": "MERCHANTS RENT-A-CAR",
    "3434": "USA RENT-A-CAR",
    "3441": "ADVANTAGE RENT-A-CAR",
    "3514": "AMERISUITES",
    "3522": "TOKYO HOTEL",
    "3526": "PRINCE HOTELS",
    "3539": "SUMMERFIELD SUITES HOTEL",
    "3546": "HOTEL SIERRA",
    "3547": "BREAKERS RESORT",
    "3551": "MIRAGE HOTEL AND CASINO",
    "3554": "PINEHURST RESORT",
    "3555": "TREASURE ISLAND HOTEL AND CASINO",
    "3556": "BARTON CREEK RESORT",
    "3557": "MANHATTAN EAST SUITE HOTELS",
    "3558": "JOLLY HOTELS",
    "3559": "CANDLEWOOD SUITES",
    "3560": "ALADDIN RESORT AND CASINO",
    "3561": "GOLDEN NUGGET",
    "3564": "SAM’S TOWN HOTEL AND CASINO",
    "3566": "GARDEN PLACE HOTEL",
    "3567": "SOHO GRAND HOTEL",
    "3569": "TRIBECA GRAND HOTEL",
    "3571": "GRAND WAILEA RESORT",
    "3576": "LA QUINTA RESORT",
    "3578": "FRANKENMUTH BAVARIAN",
    "3580": "HOTEL DEL CORONADO",
    "3582": "CALIFORNIA HOTEL AND CASINO",
    "3589": "DORAL GOLF RESORT",
    "3594": "ARIZONA BILTMORE",
    "3597": "RIVERSIDE RESORT AND CASINO",
    "3600": "SADDLEBROOK RESORT—TAMPA",
    "3601": "TRADEWINDS RESORTS",
    "3602": "HUDSON HOTEL",
    "3604": "HILTON GARDEN INN",
    "3605": "JURYS DOYLE HOTEL GROUP",
    "3606": "JEFFERSON HOTEL",
    "3607": "FONTAINEBLEAU RESORT",
    "3608": "GAYLORD OPRYLAND",
    "3609": "GAYLORD PALMS",
    "3610": "GAYLORD TEXAN",
    "3611": "C MON INN",
    "3613": "MICROTEL INN AND SUITES",
    "3614": "AMERICINN",
    "3616": "HERMITAGE HOTEL",
    "3617": "AMERICA’S BEST VALUE INN",
    "3618": "GREAT WOLF",
    "3619": "ALOFT (ALOFT HOTELS)",
    "3621": "EXTENDED STAY",
    "3622": "MERLIN HOTEL GROUP",
    "3624": "LADY LUCK HOTEL AND CASINO",
    "3627": "EXTENDED STAY AMERICA",
    "3628": "EXCALIBUR HOTEL AND CASINO",
    "3630": "EXTENDED STAY DELUXE",
    "3631": "SLEEP INNS",
    "3632": "THE PHOENICIAN",
    "3657": "OBEROI HOTELS",
    "3662": "CIRCUS CIRCUS HOTEL AND CASINO",
    "3667": "LUXOR HOTEL AND CASINO",
    "3669": "ELDORADO HOTEL AND CASINO",
    "3676": "MONTE CARLO HOTEL AND CASINO",
    "3680": "HOTEIS OTHAN",
    "3683": "BRADBURY SUITES",
    "3692": "DOUBLETREE",
    "3708": "VIRGIN RIVER HOTEL AND CASINO",
    "3723": "RICA HOTELS",
    "3735": "MASTERS ECONOMY INNS",
    "3753": "GREENBRIAR RESORTS",
    "3757": "CANYON RANCH",
    "3758": "KAHALA MANDARIN ORIENTAL HOTEL",
    "3759": "ORCHID AT MAUNA LANI",
    "3760": "HALEKULANI HOTEL/WAIKIKI PARC",
    "3761": "PRIMADONNA HOTEL AND CASINO",
    "3763": "CHATEAU ELAN WINERY AND RESORT",
    "3764": "BEAU RIVAGE HOTEL AND CASINO",
    "3765": "BELLAGIO HOTEL AND CASINO",
    "3766": "FREMONT HOTEL AND CASINO",
    "3767": "MAIN STREET HOTEL AND CASINO",
    "3768": "SILVER STAR HOTEL AND CASINO",
    "3769": "STRATOSPHERE HOTEL AND CASINO",
    "3770": "SPRINGHILL SUITES",
    "3771": "CAESARS HOTEL AND CASINO",
    "3772": "NEMACOLIN WOODLANDS",
    "3773": "VENETIAN RESORT HOTEL AND CASINO",
    "3774": "NEW YORK, NEW YORK HOTEL AND CASINO",
    "3775": "SANDS RESORT",
    "3776": "NEVELE GRANDE RESORT AND COUNTRY CLUB",
    "3777": "MANDALAY BAY RESORT",
    "3778": "FOUR POINTS HOTELS",
    "3779": "W HOTELS",
    "3780": "DISNEY RESORTS",
    "3781": "PATRICIA GRAND RESORT HOTELS",
    "3782": "ROSEN HOTELS AND RESORTS",
    "3783": "TOWN AND COUNTRY RESORT & CONVENTION CENTER",
    "3784": "FIRST HOSPITALITY HOTELS",
    "3785": "OUTRIGGER HOTELS & RESORTS",
    "3786": "OHANA HOTELS OF HAWAII",
    "3787": "CARIBE ROYALE RESORT SUITES & VILLAS",
    "3788": "ALA MOANA HOTEL",
    "3789": "SMUGGLERS’ NOTCH RESORT",
    "3790": "RAFFLES HOTELS",
    "3791": "STAYBRIDGE SUITES",
    "3792": "CLARIDGE CASINO HOTEL",
    "3793": "THE FLAMINGO HOTELS",
    "3794": "GRAND CASINO HOTELS",
    "3795": "PARIS LAS VEGAS HOTEL",
    "3796": "PEPPERMILL HOTEL CASINO",
    "3797": "ATLANTIC CITY HILTON",
    "3798": "EMBASSY VACATION RESORT",
    "3799": "HALE KOA HOTEL",
    "3800": "HOMESTEAD SUITES",
    "3802": "THE PALACE HOTEL",
    "3804": "THE DIPLOMAT COUNTRY CLUB AND SPA",
    "3805": "THE ATLANTIC",
    "3806": "PRINCEVILLE RESORT",
    "3807": "ELEMENT",
    "3808": "LXR (LUXURY RESORTS)",
    "3809": "SETTLE INN",
    "3810": "LA COSTA RESORT",
    "3811": "PREMIER INN",
    "3812": "HYATT PLACE",
    "3813": "HOTEL INDIGO",
    "3814": "THE ROOSEVELT HOTEL NY",
    "3815": "HOLIDAY INN NICKELODEON",
    "3816": "HOME2 SUITES BY HILTON",
    "3817": "AFFINIA",
    "3818": "MAINSTAY SUITES",
    "3819": "OXFORD SUITES",
    "3820": "JUMEIRAH ESSEX HOUSE",
    "3821": "CARIBE ROYALE",
    "3823": "GRAND SIERRA RESORT",
    "3824": "ARIA (ARIA RESORT AND CASINO)",
    "3825": "VDARA (VDARA HOTEL AND SPA)",
    "3826": "AUTOGRAPH",
    "3827": "GALT HOUSE",
    "3828": "COSMOPOLITAN OF LAS VEGAS",
    "3829": "COUNTRY INN BY CARLSON",
    "3830": "PARK PLAZA HOTEL",
    "3831": "WALDORF",
    "3832": "CURIO HOTELS",
    "3833": "CANOPY HOTELS",
    "3834": "BAYMONT INN AND SUITES",
    "3836": "HAWTHORNE SUITES BY WYNDHAM",
}


@lru_cache(maxsize=1)
def _mcc_catalogue() -> List[schemas.MccResponse]:
    """
    Every merchant category code that has a usable name, with its ISO range as a
    group, ordered the way a picker wants to show them.

    Wording comes from the first source that has one, preferring Stripe's over
    ISO's: ISO's descriptions are terse and occasionally truncated mid-word
    ("Miscellaneous personal services -- not elsew"), where Stripe's are written
    to be shown to a person ("Miscellaneous General Services"). Failing all
    three, `_DESCRIPTION_OVERRIDES` (general codes) and `_BRAND_NAME_OVERRIDES`
    (the 3000-3999 band) supply the ones neither iso18245 nor Stripe's brand
    list has wording for. The four-digit code is the fact; the name is only a
    label for finding it.

    Codes with no description from any source (3019, for one — a 3000-series
    slot no acquirer has claimed) are dropped rather than rendered as "(no
    description)", which is noise in a list this long.

    **Ordering is part of the contract**: the ~300 general codes come first, then
    the ~400 brand codes, each block by code. Every client wants exactly this
    order — the brand block is real but rarely wanted, and it reads as noise
    sitting between Groceries and Restaurants. Sorting it once here, where
    `is_brand` is already known and the result is cached for the process
    lifetime, is free; leaving it to the clients meant three separate re-sorts
    of the same list and a hook on the iOS picker to make one of them possible.
    Search still reaches the brand block wherever a client offers it.
    """
    catalogue: List[schemas.MccResponse] = []
    for mcc in iso18245.get_all_mccs():
        name = (
            mcc.stripe_description
            or mcc.usda_description
            or mcc.iso_description
            or _DESCRIPTION_OVERRIDES.get(mcc.mcc)
            or _BRAND_NAME_OVERRIDES.get(mcc.mcc)
        )
        if not name:
            continue
        is_brand = mcc.range.start == _BRAND_RANGE_START
        catalogue.append(schemas.MccResponse(
            code=mcc.mcc,
            name=name,
            group=_BRAND_GROUP if is_brand else mcc.range.description,
            is_brand=is_brand,
        ))
    return sorted(catalogue, key=lambda row: (row.is_brand, row.code))


@router.get("/mccs", response_model=List[schemas.MccResponse])
def get_mccs():
    """
    Merchant category codes (ISO 18245), for the optional MCC field on a card
    transaction.

    Static reference data — near enough the shape of /currencies and /timezones
    that the clients' existing searchable reference picker renders it with no new
    UI, and already in the order they all want to display.
    """
    return _mcc_catalogue()
