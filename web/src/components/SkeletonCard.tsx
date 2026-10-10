import React from 'react';
import './SkeletonCard.css';

export const SkeletonCard: React.FC = () => {
  return (
    <div className="skeleton-card">
      <div className="skeleton-header">
        <div className="skeleton-circle" />
        <div className="skeleton-line skeleton-title" />
      </div>
      <div className="skeleton-media" />
      <div className="skeleton-body">
        <div className="skeleton-line skeleton-line-full" />
        <div className="skeleton-line skeleton-line-full" />
        <div className="skeleton-line skeleton-line-half" />
      </div>
    </div>
  );
};
