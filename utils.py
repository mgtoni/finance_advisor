def get_yf_ticker(symbol):
    """
    Maps broker-specific tickers (e.g. eToro) to Yahoo Finance ticker symbols.
    """
    symbol = symbol.upper().strip()
    
    # Specific one-off overrides
    mapping = {
        'INGA.NV': 'INGA.AS',
        # Add more specific mappings here as you discover them
    }
    
    if symbol in mapping:
        return mapping[symbol]
        
    # General heuristic replacements for eToro suffixes
    # eToro often uses .NV for Dutch stocks, YF uses .AS (Amsterdam)
    if symbol.endswith('.NV'):
        return symbol.replace('.NV', '.AS')
        
    # eToro uses .L for London (same as YF), .PA for Paris (same as YF)
    # You can add more general rules here.
    
    return symbol
