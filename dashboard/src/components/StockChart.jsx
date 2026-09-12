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

const StockChart = ({ symbol, entryDate, entryPrice }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const markersPrimitiveRef = useRef(null);
  const [timeframe, setTimeframe] = useState('3M');

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
      // Note: we do NOT destroy the chart here if we only want to update data on timeframe change,
      // but since we want to clean up when the component unmounts:
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
    if (!chartRef.current || !candlestickSeriesRef.current) return;

    const days = TIMEFRAMES[timeframe];
    
    const generateMockData = (numDays) => {
      let baseTime = Math.floor(Date.now() / 1000) - (numDays * 86400); 
      let basePrice = symbol === 'MU' ? 100 : 60;
      
      // If we have an entry date and it's within the window, try to make the price near entry price around that date
      // This is just for mock visual effect.
      
      const data = [];
      for (let i = 0; i < numDays; i++) {
        const time = baseTime + (i * 86400);
        const volatility = basePrice * 0.03;
        
        // Force the price to be near entryPrice on the entryDate (mocking)
        let open, close, high, low;
        const currentDateStr = new Date(time * 1000).toISOString().split('T')[0];
        
        if (entryDate && entryDate === currentDateStr && entryPrice) {
           open = entryPrice;
           close = open + (Math.random() - 0.5) * volatility;
        } else {
           open = basePrice + (Math.random() - 0.5) * volatility;
           close = open + (Math.random() - 0.5) * volatility;
        }
        
        high = Math.max(open, close) + Math.random() * (volatility / 2);
        low = Math.min(open, close) - Math.random() * (volatility / 2);
        
        data.push({ time, open, high, low, close });
        basePrice = close;
      }
      return data;
    };

    const data = generateMockData(days);
    candlestickSeriesRef.current.setData(data);

    // Set Markers for Entry Point
    let markers = [];
    if (entryDate && entryPrice) {
      const entryTimestamp = Math.floor(new Date(entryDate).getTime() / 1000);
      
      // Only show marker if it's within the generated data range
      if (data.length > 0 && entryTimestamp >= data[0].time && entryTimestamp <= data[data.length - 1].time) {
        markers = [
          {
            time: entryTimestamp,
            position: 'belowBar',
            color: '#3b82f6',
            shape: 'arrowUp',
            text: `Entry: $${entryPrice.toFixed(2)}`,
          }
        ];
      }
    }
    
    if (!markersPrimitiveRef.current) {
      markersPrimitiveRef.current = createSeriesMarkers(candlestickSeriesRef.current, markers);
    } else {
      markersPrimitiveRef.current.setMarkers(markers);
    }

    chartRef.current.timeScale().fitContent();

  }, [symbol, timeframe, entryDate, entryPrice]);

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
