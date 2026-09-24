import os
import json
import io
import logging
import urllib.request
import pandas as pd
import requests
from dotenv import load_dotenv

# Suppress yfinance internal error logs
logging.getLogger('yfinance').setLevel(logging.CRITICAL)

load_dotenv()

UNIVERSE_DIR = os.path.join(os.path.dirname(__file__), 'universes')
os.makedirs(UNIVERSE_DIR, exist_ok=True)

class UniverseManager:
    """
    Manages complete, institutional-grade market universes for:
    - USA (S&P 500 + S&P 400 MidCap + Alpaca Tradables)
    - UK (FTSE 100 / 250 / 350)
    - Europe (STOXX Europe 600 & Continental Blue Chips)
    - Japan (Nikkei 225 & TOPIX Leaders)
    - Global (Premier International Compounders & ADRs)
    """

    def __init__(self):
        self.alpaca_key = os.getenv("ALPACA_API_KEY")
        self.alpaca_secret = os.getenv("ALPACA_SECRET_KEY")
        self.alpaca_available = bool(self.alpaca_key and self.alpaca_secret)

    def get_universe_symbols(self, market='usa'):
        """Convenience method returning list of string ticker symbols for the market."""
        univ = self.get_market_universe(market)
        return [x['symbol'] for x in univ]

    def get_market_universe(self, market='usa', force_refresh=False):
        """Returns list of ticker dictionaries [{'symbol': str, 'name': str, 'sector': str, 'market': str}]"""
        market = market.lower().strip()
        cache_path = os.path.join(UNIVERSE_DIR, f"{market}.json")

        if not force_refresh and os.path.exists(cache_path):
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if data and len(data) > 0:
                        return data
            except Exception as e:
                print(f"Notice reading cached universe for {market}: {e}")

        # Fetch fresh universe
        tickers = []
        if market == 'usa':
            tickers = self._fetch_usa_universe()
        elif market == 'uk':
            tickers = self._fetch_uk_universe()
        elif market == 'europe':
            tickers = self._fetch_europe_universe()
        elif market == 'japan':
            tickers = self._fetch_japan_universe()
        elif market == 'global':
            tickers = self._fetch_global_universe()
        else:
            tickers = self._fetch_usa_universe()

        # Cache to disk
        if tickers:
            try:
                with open(cache_path, 'w', encoding='utf-8') as f:
                    json.dump(tickers, f, indent=2)
            except Exception as e:
                print(f"Notice saving universe cache for {market}: {e}")

        return tickers

    def _fetch_usa_universe(self):
        """Uses S&P 500 & S&P 400 constituent lists prioritized first, enriched by Alpaca tradable equities."""
        print("Ingesting USA universe (S&P 500/400 + Alpaca Active Equities)...")
        tickers = []
        seen = set()

        # 1. Fetch S&P 500 constituents
        sp500_items = []
        try:
            req = urllib.request.Request(
                'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies',
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
            tables = pd.read_html(io.StringIO(html))
            if tables:
                df = tables[0]
                for _, r in df.iterrows():
                    sym = str(r['Symbol']).replace('.', '-').strip().upper()
                    if sym not in seen:
                        sp500_items.append({
                            'symbol': sym,
                            'name': str(r.get('Security', sym)),
                            'sector': str(r.get('GICS Sector', 'General')),
                            'market': 'usa',
                            'exchange': 'NYSE/NASDAQ',
                            'index': 'S&P 500',
                            'tier': 1
                        })
                        seen.add(sym)
                print(f"Loaded {len(sp500_items)} S&P 500 constituents.")
        except Exception as e:
            print(f"Notice fetching S&P 500 from Wikipedia: {e}")

        tickers.extend(sp500_items)

        # 2. Fetch S&P 400 MidCap constituents
        sp400_items = []
        try:
            req = urllib.request.Request(
                'https://en.wikipedia.org/wiki/List_of_S%26P_400_companies',
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
            tables = pd.read_html(io.StringIO(html))
            if tables:
                df = tables[0]
                for _, r in df.iterrows():
                    sym = str(r.get('Ticker symbol', r.get('Symbol', ''))).replace('.', '-').strip().upper()
                    if sym and sym not in seen:
                        sp400_items.append({
                            'symbol': sym,
                            'name': str(r.get('Company', r.get('Security', sym))),
                            'sector': str(r.get('GICS Sector', 'General')),
                            'market': 'usa',
                            'exchange': 'NYSE/NASDAQ',
                            'index': 'S&P 400',
                            'tier': 2
                        })
                        seen.add(sym)
                print(f"Loaded {len(sp400_items)} S&P 400 MidCap constituents.")
        except Exception as e:
            print(f"Notice fetching S&P 400 from Wikipedia: {e}")

        tickers.extend(sp400_items)

        # 3. Enrich with other major tradables from Alpaca (filtered for clean equities)
        alpaca_extras = []
        if self.alpaca_key and self.alpaca_secret:
            try:
                headers = {
                    "APCA-API-KEY-ID": self.alpaca_key,
                    "APCA-API-SECRET-KEY": self.alpaca_secret
                }
                res = requests.get(
                    "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",
                    headers=headers,
                    timeout=15
                )
                if res.status_code == 200:
                    assets = res.json()
                    for a in assets:
                        sym = a.get('symbol', '').strip().upper()
                        exch = a.get('exchange', '')
                        tradable = a.get('tradable', False)
                        name = a.get('name', '')

                        if not tradable or exch not in ['NASDAQ', 'NYSE', 'AMEX', 'ARCA']:
                            continue
                        if '.' in sym or '/' in sym or '-' in sym or len(sym) > 5:
                            continue
                        if any(w in name.lower() for w in ['etf', 'fund', 'trust', 'index', 'warrant', 'right', 'unit', 'acquisition corp', 'acquisition company', 'lp', 'l.p.']):
                            continue

                        if sym not in seen:
                            alpaca_extras.append({
                                'symbol': sym,
                                'name': name or sym,
                                'sector': 'General',
                                'market': 'usa',
                                'exchange': exch,
                                'source': 'alpaca',
                                'tier': 3
                            })
                            seen.add(sym)
                    print(f"Alpaca provided {len(alpaca_extras)} additional tradable US equities.")
            except Exception as e:
                print(f"Error calling Alpaca assets API: {e}")

        tickers.extend(alpaca_extras)
        print(f"Total USA universe assembled: {len(tickers)} stocks (S&P Leaders prioritized).")
        return tickers

    def _fetch_uk_universe(self):
        """Fetches FTSE 100 and FTSE 250 constituents (FTSE 350) with normalized .L suffixes."""
        print("Ingesting UK universe (FTSE 350)...")
        tickers = []
        seen = set()

        # 1. FTSE 100
        try:
            req = urllib.request.Request('https://en.wikipedia.org/wiki/FTSE_100_Index', headers={'User-Agent': 'Mozilla/5.0'})
            html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
            tables = pd.read_html(io.StringIO(html))
            ftse100 = [t for t in tables if len(t) >= 90][0]
            ticker_col = [c for c in ftse100.columns if 'Ticker' in c or 'EPIC' in c][0]
            name_col = [c for c in ftse100.columns if 'Company' in c][0]
            sec_col = [c for c in ftse100.columns if 'sector' in c.lower() or 'industry' in c.lower()][0]

            for _, r in ftse100.iterrows():
                raw = str(r[ticker_col]).strip().upper()
                # Normalize dual share classes like BT.A -> BT-A.L
                clean_sym = raw.replace('.', '-')
                sym = f"{clean_sym}.L" if not clean_sym.endswith('.L') else clean_sym

                if sym not in seen:
                    tickers.append({
                        'symbol': sym,
                        'name': str(r[name_col]),
                        'sector': str(r[sec_col]),
                        'market': 'uk',
                        'exchange': 'LSE',
                        'index': 'FTSE 100'
                    })
                    seen.add(sym)
        except Exception as e:
            print(f"Notice fetching FTSE 100: {e}")

        # 2. FTSE 250
        try:
            req = urllib.request.Request('https://en.wikipedia.org/wiki/FTSE_250_Index', headers={'User-Agent': 'Mozilla/5.0'})
            html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
            tables = pd.read_html(io.StringIO(html))
            ftse250 = [t for t in tables if len(t) >= 200][0]
            ticker_col = [c for c in ftse250.columns if 'Ticker' in c or 'EPIC' in c][0]
            name_col = [c for c in ftse250.columns if 'Company' in c][0]
            sec_col = [c for c in ftse250.columns if 'sector' in c.lower() or 'industry' in c.lower()][0]

            for _, r in ftse250.iterrows():
                raw = str(r[ticker_col]).strip().upper()
                clean_sym = raw.replace('.', '-')
                sym = f"{clean_sym}.L" if not clean_sym.endswith('.L') else clean_sym

                if sym not in seen:
                    tickers.append({
                        'symbol': sym,
                        'name': str(r[name_col]),
                        'sector': str(r[sec_col]),
                        'market': 'uk',
                        'exchange': 'LSE',
                        'index': 'FTSE 250'
                    })
                    seen.add(sym)
        except Exception as e:
            print(f"Notice fetching FTSE 250: {e}")

        # Curated fallback
        if len(tickers) < 50:
            curated_uk = [
                ('AZN.L', 'AstraZeneca', 'Healthcare'), ('SHEL.L', 'Shell plc', 'Energy'),
                ('HSBA.L', 'HSBC Holdings', 'Financials'), ('ULVR.L', 'Unilever', 'Consumer Defensive'),
                ('BP.L', 'BP plc', 'Energy'), ('RIO.L', 'Rio Tinto', 'Basic Materials'),
                ('GSK.L', 'GSK plc', 'Healthcare'), ('RELX.L', 'RELX plc', 'Technology'),
                ('DGE.L', 'Diageo', 'Consumer Defensive'), ('BATS.L', 'British American Tobacco', 'Consumer Defensive'),
                ('LSEG.L', 'London Stock Exchange Group', 'Financials'), ('NG.L', 'National Grid', 'Utilities'),
                ('BARC.L', 'Barclays', 'Financials'), ('LLOY.L', 'Lloyds Banking Group', 'Financials'),
                ('VOD.L', 'Vodafone Group', 'Communication Services'), ('HLMA.L', 'Halma', 'Technology'),
                ('SGE.L', 'Sage Group', 'Technology'), ('AUTO.L', 'Auto Trader Group', 'Communication Services'),
                ('WTB.L', 'Whitbread', 'Consumer Cyclical'), ('BME.L', 'B&M European Value Retail', 'Consumer Defensive'),
                ('CPG.L', 'Compass Group', 'Consumer Cyclical'), ('EXPN.L', 'Experian', 'Industrials'),
                ('BA.L', 'BAE Systems', 'Industrials'), ('RR.L', 'Rolls-Royce Holdings', 'Industrials')
            ]
            for sym, name, sec in curated_uk:
                if sym not in seen:
                    tickers.append({'symbol': sym, 'name': name, 'sector': sec, 'market': 'uk', 'exchange': 'LSE'})
                    seen.add(sym)

        print(f"Total UK universe assembled: {len(tickers)} stocks.")
        return tickers

    def _fetch_europe_universe(self):
        """Fetches STOXX Europe 600 constituents with native exchange suffixes (.DE, .PA, .AS, .SW, .ST, etc.)."""
        print("Ingesting Europe universe (STOXX Europe 600)...")
        tickers = []
        seen = set()

        try:
            req = urllib.request.Request('https://en.wikipedia.org/wiki/STOXX_Europe_600', headers={'User-Agent': 'Mozilla/5.0'})
            html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
            tables = pd.read_html(io.StringIO(html))
            stoxx_table = [t for t in tables if len(t) >= 300][0]

            ticker_col = [c for c in stoxx_table.columns if 'Ticker' in c or 'Symbol' in c][0]
            name_col = [c for c in stoxx_table.columns if 'Company' in c or 'Component' in c][0]
            sec_col = [c for c in stoxx_table.columns if 'sector' in c.lower() or 'industry' in c.lower()][0]
            cntry_col = [c for c in stoxx_table.columns if 'country' in c.lower()][0] if any('country' in c.lower() for c in stoxx_table.columns) else None

            COUNTRY_SUFFIX_MAP = {
                'Germany': '.DE', 'France': '.PA', 'Netherlands': '.AS', 'Switzerland': '.SW',
                'Sweden': '.ST', 'Denmark': '.CO', 'Norway': '.OL', 'Finland': '.HE',
                'Spain': '.MC', 'Italy': '.MI', 'Belgium': '.BR', 'Ireland': '.IR', 'Austria': '.VI'
            }

            for _, r in stoxx_table.iterrows():
                raw_sym = str(r[ticker_col]).strip().upper()
                name = str(r[name_col])
                sec = str(r[sec_col])
                cntry = str(r[cntry_col]) if cntry_col else 'Europe'

                if cntry == 'United Kingdom':
                    sym = f"{raw_sym.replace('.', '-')}.L" if not raw_sym.endswith('.L') else raw_sym
                else:
                    suffix = COUNTRY_SUFFIX_MAP.get(cntry, '')
                    if suffix and not any(raw_sym.endswith(s) for s in COUNTRY_SUFFIX_MAP.values()):
                        sym = f"{raw_sym.replace('.', '-')}{suffix}"
                    else:
                        sym = raw_sym

                if sym not in seen:
                    tickers.append({
                        'symbol': sym,
                        'name': name,
                        'sector': sec,
                        'country': cntry,
                        'market': 'europe',
                        'exchange': 'Continental Europe'
                    })
                    seen.add(sym)
        except Exception as e:
            print(f"Notice fetching STOXX 600: {e}")

        # Curated fallback
        if len(tickers) < 60:
            curated_eur = [
                ('SAP.DE', 'SAP SE', 'Technology', 'Germany'), ('SIE.DE', 'Siemens AG', 'Industrials', 'Germany'),
                ('ALV.DE', 'Allianz SE', 'Financials', 'Germany'), ('AIR.DE', 'Airbus SE', 'Industrials', 'Germany'),
                ('DTE.DE', 'Deutsche Telekom', 'Communication Services', 'Germany'), ('BAS.DE', 'BASF SE', 'Basic Materials', 'Germany'),
                ('BAYN.DE', 'Bayer AG', 'Healthcare', 'Germany'), ('MBG.DE', 'Mercedes-Benz Group', 'Consumer Cyclical', 'Germany'),
                ('BMW.DE', 'BMW AG', 'Consumer Cyclical', 'Germany'), ('MUV2.DE', 'Munich Re', 'Financials', 'Germany'),
                ('SY1.DE', 'Symrise AG', 'Basic Materials', 'Germany'), ('BEI.DE', 'Beiersdorf AG', 'Consumer Defensive', 'Germany'),
                ('HEI.DE', 'Heidelberg Materials', 'Basic Materials', 'Germany'), ('EVK.DE', 'Evonik Industries', 'Basic Materials', 'Germany'),
                ('MC.PA', 'LVMH Moet Hennessy', 'Consumer Cyclical', 'France'), ('OR.PA', "L'Oreal", 'Consumer Defensive', 'France'),
                ('RMS.PA', 'Hermes International', 'Consumer Cyclical', 'France'), ('TTE.PA', 'TotalEnergies', 'Energy', 'France'),
                ('SAN.PA', 'Sanofi', 'Healthcare', 'France'), ('AIR.PA', 'Airbus SE', 'Industrials', 'France'),
                ('SU.PA', 'Schneider Electric', 'Industrials', 'France'), ('AI.PA', 'Air Liquide', 'Basic Materials', 'France'),
                ('BNP.PA', 'BNP Paribas', 'Financials', 'France'), ('DG.PA', 'Vinci SA', 'Industrials', 'France'),
                ('CAP.PA', 'Capgemini', 'Technology', 'France'), ('ENGI.PA', 'Engie', 'Utilities', 'France'),
                ('VIE.PA', 'Veolia Environnement', 'Utilities', 'France'),
                ('ASML.AS', 'ASML Holding', 'Technology', 'Netherlands'), ('PRX.AS', 'Prosus NV', 'Technology', 'Netherlands'),
                ('INGA.AS', 'ING Groep', 'Financials', 'Netherlands'), ('WKL.AS', 'Wolters Kluwer', 'Industrials', 'Netherlands'),
                ('HEIA.AS', 'Heineken NV', 'Consumer Defensive', 'Netherlands'), ('ADYEN.AS', 'Adyen NV', 'Technology', 'Netherlands'),
                ('NESN.SW', 'Nestle SA', 'Consumer Defensive', 'Switzerland'), ('NOVN.SW', 'Novartis AG', 'Healthcare', 'Switzerland'),
                ('ROG.SW', 'Roche Holding', 'Healthcare', 'Switzerland'), ('UBSG.SW', 'UBS Group AG', 'Financials', 'Switzerland'),
                ('ABBN.SW', 'ABB Ltd', 'Industrials', 'Switzerland'), ('SIKA.SW', 'Sika AG', 'Basic Materials', 'Switzerland'),
                ('ATCO-A.ST', 'Atlas Copco', 'Industrials', 'Sweden'), ('VOLV-B.ST', 'Volvo AB', 'Industrials', 'Sweden'),
                ('ASSA-B.ST', 'Assa Abloy', 'Industrials', 'Sweden'), ('SAND.ST', 'Sandvik AB', 'Industrials', 'Sweden'),
                ('NOVO-B.CO', 'Novo Nordisk', 'Healthcare', 'Denmark'), ('DSV.CO', 'DSV A/S', 'Industrials', 'Denmark'),
                ('EQNR.OL', 'Equinor ASA', 'Energy', 'Norway'), ('DNB.OL', 'DNB Bank ASA', 'Financials', 'Norway'),
                ('KNEBV.HE', 'Kone Oyj', 'Industrials', 'Finland'),
                ('IBE.MC', 'Iberdrola SA', 'Utilities', 'Spain'), ('SAN.MC', 'Banco Santander', 'Financials', 'Spain'),
                ('ITX.MC', 'Inditex', 'Consumer Cyclical', 'Spain'), ('ENEL.MI', 'Enel SpA', 'Utilities', 'Italy'),
                ('ISP.MI', 'Intesa Sanpaolo', 'Financials', 'Italy'), ('RACE.MI', 'Ferrari NV', 'Consumer Cyclical', 'Italy')
            ]
            for sym, name, sec, cntry in curated_eur:
                if sym not in seen:
                    tickers.append({'symbol': sym, 'name': name, 'sector': sec, 'country': cntry, 'market': 'europe', 'exchange': 'Continental Europe'})
                    seen.add(sym)

        print(f"Total Europe universe assembled: {len(tickers)} stocks.")
        return tickers

    def _fetch_japan_universe(self):
        """Returns liquid Tokyo Stock Exchange (TSE Prime) leaders with .T suffix."""
        print("Ingesting Japan universe (TSE Prime & Nikkei Leaders)...")
        curated_jp = [
            ('7203.T', 'Toyota Motor', 'Consumer Cyclical'), ('6758.T', 'Sony Group', 'Technology'),
            ('6861.T', 'Keyence Corp', 'Technology'), ('8035.T', 'Tokyo Electron', 'Technology'),
            ('6902.T', 'Denso Corp', 'Consumer Cyclical'), ('6501.T', 'Hitachi Ltd', 'Industrials'),
            ('4063.T', 'Shin-Etsu Chemical', 'Basic Materials'), ('8001.T', 'ITOCHU Corp', 'Industrials'),
            ('8058.T', 'Mitsubishi Corp', 'Industrials'), ('9432.T', 'NTT Corp', 'Communication Services'),
            ('4502.T', 'Takeda Pharmaceutical', 'Healthcare'), ('7751.T', 'Canon Inc', 'Technology'),
            ('6301.T', 'Komatsu Ltd', 'Industrials'), ('7267.T', 'Honda Motor', 'Consumer Cyclical'),
            ('9984.T', 'SoftBank Group', 'Communication Services'), ('9983.T', 'Fast Retailing', 'Consumer Cyclical'),
            ('8306.T', 'Mitsubishi UFJ Financial', 'Financials'), ('8316.T', 'Sumitomo Mitsui Financial', 'Financials'),
            ('8411.T', 'Mizuho Financial Group', 'Financials'), ('6503.T', 'Mitsubishi Electric', 'Industrials'),
            ('6702.T', 'Fujitsu Ltd', 'Technology'), ('6971.T', 'Kyocera Corp', 'Technology'),
            ('7733.T', 'Olympus Corp', 'Healthcare'), ('4519.T', 'Chugai Pharmaceutical', 'Healthcare'),
            ('4568.T', 'Daiichi Sankyo', 'Healthcare'), ('4901.T', 'Fujifilm Holdings', 'Technology'),
            ('7974.T', 'Nintendo Co Ltd', 'Communication Services'), ('8766.T', 'Tokio Marine Holdings', 'Financials'),
            ('6981.T', 'Murata Manufacturing', 'Technology'), ('6273.T', 'SMC Corp', 'Industrials'),
            ('4452.T', 'Kao Corp', 'Consumer Defensive'), ('2914.T', 'Japan Tobacco', 'Consumer Defensive'),
            ('6594.T', 'Nidec Corp', 'Industrials'), ('5108.T', 'Bridgestone Corp', 'Consumer Cyclical'),
            ('9433.T', 'KDDI Corp', 'Communication Services'), ('6723.T', 'Renesas Electronics', 'Technology')
        ]
        tickers = []
        for sym, name, sec in curated_jp:
            tickers.append({
                'symbol': sym,
                'name': name,
                'sector': sec,
                'country': 'Japan',
                'market': 'japan',
                'exchange': 'TSE'
            })
        print(f"Total Japan universe assembled: {len(tickers)} stocks.")
        return tickers

    def _fetch_global_universe(self):
        """Blends premier non-US compounders across UK, Europe, Japan, Canada, Australia, and international ADRs."""
        print("Assembling Global International universe...")
        tickers = []
        seen = set()

        eur = self._fetch_europe_universe()
        for e in eur[:40]:
            if e['symbol'] not in seen:
                tickers.append(e); seen.add(e['symbol'])

        uk = self._fetch_uk_universe()
        for u in uk[:30]:
            if u['symbol'] not in seen:
                tickers.append(u); seen.add(u['symbol'])

        jp = self._fetch_japan_universe()
        for j in jp[:25]:
            if j['symbol'] not in seen:
                tickers.append(j); seen.add(j['symbol'])

        can_aus = [
            ('RY.TO', 'Royal Bank of Canada', 'Financials', 'Canada'),
            ('CSU.TO', 'Constellation Software', 'Technology', 'Canada'),
            ('OTEX.TO', 'Open Text', 'Technology', 'Canada'),
            ('WCN.TO', 'Waste Connections', 'Industrials', 'Canada'),
            ('BNS.TO', 'Bank of Nova Scotia', 'Financials', 'Canada'),
            ('TRP.TO', 'TC Energy', 'Energy', 'Canada'),
            ('BHP.AX', 'BHP Group', 'Basic Materials', 'Australia'),
            ('CSL.AX', 'CSL Limited', 'Healthcare', 'Australia'),
            ('WES.AX', 'Wesfarmers', 'Consumer Cyclical', 'Australia'),
            ('FMG.AX', 'Fortescue Metals', 'Basic Materials', 'Australia'),
            ('TSM', 'Taiwan Semiconductor (ADR)', 'Technology', 'Taiwan'),
            ('MELI', 'MercadoLibre', 'Consumer Cyclical', 'Latin America'),
            ('CRH', 'CRH plc', 'Basic Materials', 'Ireland'),
            ('INFY', 'Infosys (ADR)', 'Technology', 'India'),
            ('VALE', 'Vale SA (ADR)', 'Basic Materials', 'Brazil'),
            ('NVO', 'Novo Nordisk (ADR)', 'Healthcare', 'Denmark')
        ]
        for sym, name, sec, cntry in can_aus:
            if sym not in seen:
                tickers.append({'symbol': sym, 'name': name, 'sector': sec, 'country': cntry, 'market': 'global', 'exchange': 'Global'})
                seen.add(sym)

        print(f"Total Global universe assembled: {len(tickers)} stocks.")
        return tickers
