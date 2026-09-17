# Financial Advisor Project Guidelines & Invariants

These guidelines apply across the backend (Flask / Python / Supabase) and frontend (React / Vite / Recharts) components of the Financial Advisor workspace.

## 1. AI Analysis & Financial Prompting
- **Honest, Objective & Critical Feedback**: The AI must provide realistic, objective risk analysis. Avoid sycophancy or overly flattering/complimentary assessments. Highlight vulnerabilities, macro headwinds, and portfolio concentration risks.
- **No Forced Action Alignment**: Do not restrict or force the AI's macro/portfolio recommendations to match micro/individual stock ratings (e.g., do not forbid "SELL" recommendations on assets with individual "BUY/HOLD" ratings). Instead, feed the individual stock data and context into the prompt and allow the model to evaluate the whole-portfolio trade-offs independently.
- **Depth of Insights**: Synthesis outputs must be substantive and comprehensive (provide detailed, actionable takeaways beyond surface-level bullet points).

## 2. Backend & Data Serialization (Python / Flask / yfinance)
- **Sanitize NumPy & Pandas Types**: Flask's `jsonify` cannot serialize NumPy data types (`numpy.float64`, `numpy.int64`) or Pandas `NaN`/`NaT` values. When extracting financial data from `yfinance` or Pandas DataFrames, always safely convert them to standard Python primitives (`float(val)`, `int(val)`, or `None` if `pd.isna(val)`) before returning in API responses or writing to Supabase.
- **Explicit Imports**: Always ensure supporting libraries (`import pandas as pd`, `import numpy as np`) are imported in all service modules where DataFrame or NaN operations are used.

## 3. Data Cadence & Fetching
- **Quarterly Data Fetching**: Do not implement daily polling or aggressive cron jobs for quarterly fundamentals or financial statements. Financial reporting only changes quarterly; prefer on-demand API fetching (when opening a stock modal) with DB caching and quarterly refresh cycles.

## 4. UI, Charts & Accessibility (React / CSS)
- **High-Contrast Chart Tooltips**: When styling tooltips for Recharts or custom chart overlays in dark mode, explicitly specify high-contrast styling (e.g., solid white background `#ffffff` with black text `#000000`, padding, and border radius) to prevent unreadable dark-on-dark text.
- **Avoid Horizontal Scrolling**: Performance panels, portfolio tables, and modals should be styled with sufficient width to display columns cleanly without horizontal scrollbars.
- **Detailed Slice Hover**: Pie and breakdown charts (e.g., sector/country breakdowns) should display the percentage, value, and the specific underlying assets in their hover tooltips.
