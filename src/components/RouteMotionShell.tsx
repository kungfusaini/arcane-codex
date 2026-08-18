"use client";

import { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export function RouteMotionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isEntering, setEntering] = useState(true);
  const [routePath, setRoutePath] = useState(pathname);

  useEffect(() => {
    if (pathname !== routePath) {
      setRoutePath(pathname);
    }

    setEntering(false);
    const frame = requestAnimationFrame(() => setEntering(true));

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [pathname, routePath]);

  return (
    <div
      className={`route-motion-shell ${isEntering ? 'route-motion-shell--active' : 'route-motion-shell--inactive'}`}
      data-route={routePath}
      data-route-motion={isEntering ? 'entered' : 'entering'}
    >
      {children}
    </div>
  );
}
