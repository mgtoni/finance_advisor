import React, { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';

const TIMEFRAMES = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '3Y': 1095,
  'ALL': 2000 // Just a large number for mock data
};

const StockChart = ({ symbol, positions, currentPrice }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const markersPrimitiveRef = useRef(null);
  const [timeframe, setTimeframe] = useState('1Y');

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

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;

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

            chartRef.current.timeScale().fitContent();
        }
      } catch (err) {
        console.error("Failed to fetch historical data:", err);
      }
    };
    
    fetchHistory();

    return () => { isMounted = false; };
  }, [symbol, timeframe, positions]);

  return (
    <div>
      <div className="chart-controls" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
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
      <div ref={chartContainerRef} className="chart-container" />
    </div>
  );
};

export default StockChart;
