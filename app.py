from flask import Flask, request, jsonify, render_template
import yfinance as yf
import pandas as pd
import os

# Point Flask to the 'public' folder where your index.html lives
app = Flask(__name__, template_folder='public', static_folder='public')

@app.route('/')
def serve_frontend():
    return render_template('index.html')

@app.route('/api/data', methods=['GET'])
def get_data():
    ticker_symbol = request.args.get('ticker', 'V').upper()
    try:
        stock = yf.Ticker(ticker_symbol)
        
        # 1. Fetch real historical weekly prices (10 years)
        hist = stock.history(period="10y", interval="1wk")
        if hist.empty:
            return jsonify({"error": "No price data found for this ticker."}), 404

        price_data =[]
        for date, row in hist.iterrows():
            if pd.isna(row['Close']): continue
            price_data.append({
                "time": date.strftime('%Y-%m-%d'),
                "open": row['Open'],
                "high": row['High'],
                "low": row['Low'],
                "close": row['Close']
            })

        # 2. Fetch quarterly earnings to calculate TTM P/E
        pe_data =[]
        try:
            q_income = stock.quarterly_income_stmt
            eps_key = 'Diluted EPS' if 'Diluted EPS' in q_income.index else 'Basic EPS'
            
            if eps_key in q_income.index:
                eps_q = q_income.loc[eps_key].dropna().sort_index()
                
                # Sum the last 4 quarters for TTM EPS
                ttm_eps = eps_q.rolling(window=4).sum().dropna()

                for date, row in hist.iterrows():
                    # Strip timezones to safely compare historical price dates with earnings dates
                    safe_date = date.tz_localize(None) if date.tzinfo else date
                    safe_eps_dates = ttm_eps.index.tz_localize(None) if ttm_eps.index.tzinfo else ttm_eps.index
                    
                    past_eps = ttm_eps[safe_eps_dates <= safe_date]
                    if not past_eps.empty:
                        latest_ttm_eps = past_eps.iloc[-1]
                        if latest_ttm_eps > 0:  # Ignore negative P/E for standard charting
                            pe = row['Close'] / latest_ttm_eps
                            pe_data.append({
                                "time": date.strftime('%Y-%m-%d'),
                                "value": round(pe, 2)
                            })
        except Exception as e:
            print(f"P/E Calculation Error: {e}")

        return jsonify({
            "ticker": ticker_symbol,
            "price": price_data,
            "pe": pe_data
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)