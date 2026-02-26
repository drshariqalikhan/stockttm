import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Instantiate YahooFinance V3
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Serve the frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Route for Chart Data
app.get('/api/data', async (req, res) => {
    const ticker = (req.query.ticker || 'V').toUpperCase();
    
    try {
        // 1. Fetch 10 Years of Historical Weekly Prices
        const tenYearsAgo = new Date();
        tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
        const today = new Date();
        
        // --- THE FIX: Use the new chart() API and explicitly provide period2 (end date) ---
        const chartResult = await yahooFinance.chart(ticker, {
            period1: tenYearsAgo,
            period2: today,
            interval: '1wk'
        });

        // The chart API returns data inside a 'quotes' array
        const hist = chartResult.quotes;

        if (!hist || hist.length === 0) {
            return res.status(404).json({ error: "No price data found for this ticker." });
        }

        const priceData = hist
            .filter(row => row.close !== null) // Safety check: ignore weeks with missing data
            .map(row => ({
                time: new Date(row.date).toISOString().split('T')[0],
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close
            }));

        // 2. Fetch Quarterly Earnings to calculate TTM P/E
        let peData =[];
        try {
            const quote = await yahooFinance.quoteSummary(ticker, { 
                modules: ['incomeStatementHistoryQuarterly'] 
            });
            
            const incomeStmt = quote.incomeStatementHistoryQuarterly?.incomeStatementHistory ||[];
            
            // Sort ascending by date
            incomeStmt.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

            // Extract valid EPS data
            const epsData = incomeStmt
                .map(q => ({ date: new Date(q.endDate), eps: q.dilutedEPS || q.basicEPS }))
                .filter(q => q.eps != null);

            // Need at least 4 quarters to calculate Trailing Twelve Months (TTM)
            if (epsData.length >= 4) {
                let ttmEpsHistory =[];
                for (let i = 3; i < epsData.length; i++) {
                    let ttmEps = epsData[i-3].eps + epsData[i-2].eps + epsData[i-1].eps + epsData[i].eps;
                    ttmEpsHistory.push({ date: epsData[i].date, ttmEps: ttmEps });
                }

                // Map the calculated TTM P/E to our historical price dates
                priceData.forEach(pricePoint => {
                    const priceDate = new Date(pricePoint.time);
                    
                    // Find the latest TTM EPS available on or before this priceDate
                    let applicableTtmEps = null;
                    for (let i = ttmEpsHistory.length - 1; i >= 0; i--) {
                        if (priceDate >= ttmEpsHistory[i].date) {
                            applicableTtmEps = ttmEpsHistory[i].ttmEps;
                            break;
                        }
                    }

                    if (applicableTtmEps && applicableTtmEps > 0) {
                        peData.push({
                            time: pricePoint.time,
                            value: parseFloat((pricePoint.close / applicableTtmEps).toFixed(2))
                        });
                    }
                });
            }
        } catch (peError) {
            console.error(`P/E Calculation Error for ${ticker}:`, peError.message);
        }

        res.json({
            ticker: ticker,
            price: priceData,
            pe: peData
        });

    } catch (error) {
        console.error("API Error:", error.message);
        res.status(500).json({ error: error.message || "Failed to fetch data" });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});