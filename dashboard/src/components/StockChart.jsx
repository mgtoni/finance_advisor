import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';

const StockChart = ({ symbol }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create Chart
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

    // Mock data for the chart since we don't have historical OHLCV in Supabase yet.
    // In a real scenario, we'd fetch from an API route or Supabase.
    // We'll generate a realistic looking random walk for demonstration.
    const generateMockData = () => {
      let baseTime = Math.floor(Date.now() / 1000) - (100 * 86400); // 100 days ago
      let basePrice = symbol === 'MU' ? 100 : 60;
      const data = [];
      for (let i = 0; i < 100; i++) {
        const volatility = basePrice * 0.02;
        const open = basePrice + (Math.random() - 0.5) * volatility;
        const close = open + (Math.random() - 0.5) * volatility;
        const high = Math.max(open, close) + Math.random() * (volatility / 2);
        const low = Math.min(open, close) - Math.random() * (volatility / 2);
        
        data.push({
          time: baseTime + (i * 86400),
          open, high, low, close
        });
        basePrice = close;
      }
      return data;
    };

    candlestickSeries.setData(generateMockData());
    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, [symbol]);

  return <div ref={chartContainerRef} className="chart-container" />;
};

export default StockChart;
