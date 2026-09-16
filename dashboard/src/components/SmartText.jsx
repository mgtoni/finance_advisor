import React, { useState } from 'react';
import { glossary } from '../data/glossary';

const SmartText = ({ text }) => {
  if (!text) return null;

  // Find terms in text and wrap them in a tooltip span
  // Sort by length descending to match longer terms first (e.g. "P/E Ratio" before "P/E")
  const terms = Object.keys(glossary).sort((a, b) => b.length - a.length);
  
  // Escape regex specials
  const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  const pattern = new RegExp(`\\b(${terms.map(escapeRegex).join('|')})\\b`, 'gi');

  const parts = [];
  let lastIndex = 0;
  
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
    }
    
    // Add the matched term
    const matchedTerm = match[0];
    // Find original casing of key in glossary
    const originalKey = terms.find(t => t.toLowerCase() === matchedTerm.toLowerCase());
    
    parts.push({ 
      type: 'term', 
      content: matchedTerm,
      definition: glossary[originalKey]
    });
    
    lastIndex = pattern.lastIndex;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.substring(lastIndex) });
  }

  if (parts.length === 0) {
    return <span>{text}</span>;
  }

  return (
    <span>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={index}>{part.content}</span>;
        } else {
          return (
            <span key={index} className="smart-term" title={part.definition} style={{
              borderBottom: '1px dashed var(--accent-blue)',
              cursor: 'help',
              color: 'var(--text-primary)'
            }}>
              {part.content}
            </span>
          );
        }
      })}
    </span>
  );
};

export default SmartText;
