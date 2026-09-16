import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers } from 'lightweight-charts';

const TIMEFRAMES = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '3Y': 1095,
  'ALL': 2000 // Just a large number for mock data
};

const calculateSMA = (data, count) => {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < count - 1) continue;
    let sum = 0;
    for (let j = 0; j < count; j++) {
      sum += data[i - j].close;
    }
    result.push({ time: data[i].time, value: sum / count });
  }
  return result;
};

const calculateRSI = (data, period = 14) => {
  if (data.length <= period) return [];
  const result = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i-1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < data.length; i++) {
    if (i > period) {
      const change = data[i].close - data[i-1].close;
      avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
    }
    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    result.push({ time: data[i].time, value: rsi });
  }
  return result;
};

const calculateEMA = (data, period) => {
  const k = 2 / (period + 1);
  const result = [];
  let ema = data[0].close;
  for (let i = 0; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
    result.push(ema);
  }
  return result;
};

const calculateMACD = (data) => {
  if (data.length < 26) return [];
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const macdLine = [];
  for (let i = 0; i < data.length; i++) {
    macdLine.push({ time: data[i].time, close: ema12[i] - ema26[i] }); 
  }
  const signalLine = calculateEMA(macdLine, 9);
  
  const result = [];
  for (let i = 0; i < data.length; i++) {
    result.push({ 
      time: data[i].time, 
      value: macdLine[i].close - signalLine[i],
      color: (macdLine[i].close - signalLine[i]) >= 0 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
    });
  }
  return result;
};

const StockChart = ({ symbol, positions, currentPrice }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const smaSeriesRef = useRef(null);
  const rsiSeriesRef = useRef(null);
  const macdSeriesRef = useRef(null);
  const markersPrimitiveRef = useRef(null);
  const [timeframe, setTimeframe] = useState('1Y');
  const [showSMA, setShowSMA] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (!chartRef.current) {
      // Create Chart only once
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: '#94a3b8',
        },
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        width: chartContainerRef.current.clientWidth,
        height: 400,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        },
      });

      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      });

      const smaSeries = chart.addSeries(LineSeries, {
        color: 'rgba(59, 130, 246, 0.8)',
        lineWidth: 2,
        crosshairMarkerVisible: false,
      });
      
      const rsiSeries = chart.addSeries(LineSeries, {
        color: '#8b5cf6',
        lineWidth: 2,
        priceScaleId: 'left',
      });
      
      const macdSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: 'left',
      });

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;
      smaSeriesRef.current = smaSeries;
      rsiSeriesRef.current = rsiSeries;
      macdSeriesRef.current = macdSeries;

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };

      window.addEventListener('resize', handleResize);

      // Cleanup resize listener on unmount
      return () => {
        window.removeEventListener('resize', handleResize);
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }
      };
    }
  }, []); // Empty dependency array so chart is created once

  // Update data and markers when timeframe, symbol, or entry changes
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current || !symbol) return;

    let isMounted = true;

    const fetchHistory = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || '';
        const response = await fetch(`${apiUrl}/api/history/${symbol}?timeframe=${timeframe}`);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        
        if (!isMounted) return;
        
        if (data.length > 0) {
            // Remove duplicate timestamps if any, and ensure strictly increasing
            const uniqueData = data.filter((v, i, a) => a.findIndex(t => (t.time === v.time)) === i).sort((a,b) => a.time - b.time);
            
            candlestickSeriesRef.current.setData(uniqueData);
            
            // Set Markers for Entry Points
            let markers = [];
            if (positions && positions.length > 0) {
              const markersByTime = {};
              positions.forEach(pos => {
                if (pos.open_date && pos.entry_price) {
                  const entryTimestamp = Math.floor(new Date(pos.open_date).getTime() / 1000);
                  if (entryTimestamp >= uniqueData[0].time && entryTimestamp <= uniqueData[uniqueData.length - 1].time) {
                    if (!markersByTime[entryTimestamp]) {
                      markersByTime[entryTimestamp] = [];
                    }
                    markersByTime[entryTimestamp].push(Number(pos.entry_price));
                  }
                }
              });

              Object.keys(markersByTime).forEach(timeStr => {
                const time = parseInt(timeStr);
                const prices = markersByTime[timeStr];
                const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
                const text = prices.length > 1 ? `Entries (~$${avgPrice.toFixed(2)})` : `Entry: $${prices[0].toFixed(2)}`;
                markers.push({
                  time: time,
                  position: 'belowBar',
                  color: '#3b82f6',
                  shape: 'arrowUp',
                  text: text,
                });
              });
              
              // Sort markers by time as required by lightweight-charts
              markers.sort((a, b) => a.time - b.time);
            }
            
            if (!markersPrimitiveRef.current) {
              markersPrimitiveRef.current = createSeriesMarkers(candlestickSeriesRef.current, markers);
            } else {
              markersPrimitiveRef.current.setMarkers(markers);
            }

            if (showSMA) {
              const smaData = calculateSMA(uniqueData, 20);
              smaSeriesRef.current.setData(smaData);
            } else {
              smaSeriesRef.current.setData([]);
            }
            
            if (showRSI) {
              const rsiData = calculateRSI(uniqueData);
              rsiSeriesRef.current.setData(rsiData);
            } else {
              rsiSeriesRef.current.setData([]);
            }
            
            if (showMACD) {
              const macdData = calculateMACD(uniqueData);
              macdSeriesRef.current.setData(macdData);
            } else {
              macdSeriesRef.current.setData([]);
            }

            chartRef.current.timeScale().fitContent();
        }
      } catch (err) {
        console.error("Failed to fetch historical data:", err);
      }
    };
    
    fetchHistory();

    return () => { isMounted = false; };
  }, [symbol, timeframe, positions, showSMA, showRSI, showMACD]);

  return (
    <div>
      <div className="chart-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {Object.keys(TIMEFRAMES).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`timeframe-btn ${timeframe === tf ? 'active' : ''}`}
            >
              {tf}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button 
            onClick={() => setShowSMA(!showSMA)}
            className={`timeframe-btn ${showSMA ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--accent-blue)' }}
          >
            SMA (20)
          </button>
          <button 
            onClick={() => setShowRSI(!showRSI)}
            className={`timeframe-btn ${showRSI ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid #8b5cf6' }}
          >
            RSI (14)
          </button>
          <button 
            onClick={() => setShowMACD(!showMACD)}
            className={`timeframe-btn ${showMACD ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid #ec4899' }}
          >
            MACD Histogram
          </button>
        </div>
      </div>
      {showSMA && (
        <div style={{ marginBottom: '0.5rem', padding: '0.75rem', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '6px', fontSize: '0.85rem' }}>
          <strong>SMA (Simple Moving Average):</strong> Smooths out short-term fluctuations to reveal the underlying trend.
        </div>
      )}
      {showRSI && (
        <div style={{ marginBottom: '0.5rem', padding: '0.75rem', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '6px', fontSize: '0.85rem' }}>
          <strong>RSI (Relative Strength Index):</strong> Measures momentum. Over 70 indicates the asset may be overbought, under 30 indicates it may be oversold.
        </div>
      )}
      {showMACD && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(236, 72, 153, 0.1)', border: '1px solid rgba(236, 72, 153, 0.2)', borderRadius: '6px', fontSize: '0.85rem' }}>
          <strong>MACD Histogram:</strong> Shows the difference between the MACD line and the signal line. Green bars indicate bullish momentum, red indicates bearish.
        </div>
      )}
      <div ref={chartContainerRef} className="chart-container" />
    </div>
  );
};

export default StockChart;
