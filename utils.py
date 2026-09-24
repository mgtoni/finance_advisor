import re
import numpy as np
import pandas as pd

def get_yf_ticker(symbol):
    """
    Maps broker-specific tickers (e.g. eToro) to Yahoo Finance ticker symbols.
    """
    if not symbol:
        return ''
    symbol = str(symbol).upper().strip()
    
    # Specific one-off overrides
    mapping = {
        'INGA.NV': 'INGA.AS',
    }
    
    if symbol in mapping:
        return mapping[symbol]
        
    if symbol.endswith('.NV'):
        return symbol.replace('.NV', '.AS')
        
    return symbol


def get_company_identity(sym, info=None):
    """
    Returns (canonical_base, normalized_name) to reliably identify cross-listed stocks,
    ADRs, and multi-class shares of the exact same underlying company across global markets.
    """
    if not sym:
        return '', ''
    sym_str = str(sym).strip().upper()
    base_sym = sym_str.split('.')[0]
    CROSS_LIST_MAP = {
        'BATS': 'BTI', 'BTI': 'BTI',
        'NOVO-B': 'NVO', 'NVO': 'NVO',
        'ATCO-A': 'ATCO', 'ATCO-B': 'ATCO', 'ATCO': 'ATCO',
        'VOLV-A': 'VOLV', 'VOLV-B': 'VOLV', 'VOLV': 'VOLV',
        'SAN': 'SNY', 'SNY': 'SNY',
        'NESN': 'NSRGY', 'NSRGY': 'NSRGY',
        'NOVN': 'NVS', 'NVS': 'NVS',
        'ROG': 'RHHBY', 'RHHBY': 'RHHBY',
        'ULVR': 'UL', 'UL': 'UL',
        'BP': 'BP',
        'SHEL': 'SHEL',
        'RIO': 'RIO',
        'BHP': 'BHP',
        'SAP': 'SAP',
        'ASML': 'ASML',
        'AZN': 'AZN',
        'GSK': 'GSK',
        'ALV': 'ALV',
        'BAS': 'BAS',
        'MC': 'LVMH', 'LVMUY': 'LVMH',
        'OR': 'OR', 'LRLCY': 'OR',
        'CDI': 'CDI', 'CHDRY': 'CDI',
        'RMS': 'RMS', 'HESAY': 'RMS',
        'AIR': 'AIR', 'EADSY': 'AIR',
        'DTE': 'DTE', 'DTEGY': 'DTE',
        'BMW': 'BMW', 'BMWYY': 'BMW',
        'MBG': 'MBG', 'MBGAF': 'MBG',
        'ENGI': 'ENGI', 'ENGIY': 'ENGI',
        'VIE': 'VIE', 'VEOEY': 'VIE',
        'DG': 'DG', 'VNCIY': 'DG',
        'CAP': 'CAP', 'CGEMY': 'CAP',
        'HEIA': 'HEIA', 'HEINY': 'HEIA',
        'WKL': 'WKL', 'WTKWY': 'WKL',
        'DSV': 'DSV', 'DSDVY': 'DSV',
        'KNEBV': 'KNEBV', 'KNYJY': 'KNEBV',
        'SAND': 'SAND', 'SDVKY': 'SAND',
        'ASSA-B': 'ASSA', 'ASAZY': 'ASSA',
        'DNB': 'DNB', 'DNBBY': 'DNB',
        'EQNR': 'EQNR',
        'RY': 'RY',
        'TD': 'TD',
        'BNS': 'BNS',
        'TRP': 'TRP',
        'CSU': 'CSU',
        'OTEX': 'OTEX',
        'WCN': 'WCN',
        'NTR': 'NTR',
        'CSL': 'CSL', 'CSLYY': 'CSL',
        'WES': 'WES', 'WFAFY': 'WES',
        'WOW': 'WOW', 'BMRNY': 'WOW',
        'FMG': 'FMG', 'FSUGY': 'FMG',
        'TSM': 'TSM',
        'INFY': 'INFY',
        'VALE': 'VALE',
        'MELI': 'MELI',
        'CRH': 'CRH',
        'FMX': 'FMX',
        'GRMN': 'GRMN',
        'PBR': 'PBR', 'PETR4': 'PBR'
    }
    canonical_base = CROSS_LIST_MAP.get(base_sym, base_sym)
    
    clean_name = ''
    if info and isinstance(info, dict):
        raw_name = info.get('shortName') or info.get('longName') or ''
        clean = re.sub(
            r'[\s\.\,\-]+(plc|inc|incorporated|corp|corporation|ltd|limited|ag|se|sa|nv|holdings|group|a\/s|ab|ord|ordinary|shares|company|co|the|- new york|adr).*$',
            '', raw_name.lower()
        )
        clean_name = re.sub(r'[^a-z0-9]', '', clean)[:10]
        
    return canonical_base, clean_name


def sanitize_value(val):
    """Safely converts NumPy/Pandas types and NaNs to standard Python primitives."""
    if val is None:
        return None
    if isinstance(val, (bool, str)):
        return val
    if isinstance(val, (float, np.floating)):
        return None if (pd.isna(val) or np.isnan(val) or np.isinf(val)) else float(round(val, 4))
    if isinstance(val, (int, np.integer)):
        return int(val)
    if isinstance(val, dict):
        return {str(k): sanitize_value(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [sanitize_value(v) for v in val]
    if pd.isna(val):
        return None
    return str(val)
