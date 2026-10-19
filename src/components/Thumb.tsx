import { useState } from 'react';
import { formatDuration } from '../lib/time';
import { domainOf } from '../lib/url';
import type { Item } from '../types';

type ThumbItem = Pick<Item, 'kind' | 'image' | 'url' | 'siteName' | 'duration'>;

/** The page's own image when there is one; otherwise a tile in the topic's color. */
export function Thumb({ item, hue }: { item: ThumbItem; hue: number }) {
  const [failed, setFailed] = useState(false);
  if (item.kind === 'note') return <div className="thumb note">note</div>;
  const letter = (item.siteName || domainOf(item.url) || '?').replace(/^www\./, '').charAt(0).toUpperCase();
  const showImage = item.image && !failed;
  const duration = formatDuration(item.duration);
  return (
    <div className="thumb" style={showImage ? undefined : { background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 30) % 360} 60% 30%))` }}>
      {showImage ? (
        <img src={item.image!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : item.kind === 'video' ? null : (
        letter
      )}
      {item.kind === 'video' && <span className="play">▶</span>}
      {item.kind === 'video' && duration && <span className="dur">{duration}</span>}
    </div>
  );
}
