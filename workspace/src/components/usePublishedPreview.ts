"use client";

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'arcane-published-preview';

function readStoredPreview(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.sessionStorage.getItem(STORAGE_KEY) === 'true';
}

export function usePublishedPreview(forcedReadOnly: boolean) {
  const [previewPublished, setPreviewPublishedState] = useState(false);

  useEffect(() => {
    if (forcedReadOnly) {
      setPreviewPublishedState(false);
      return;
    }

    setPreviewPublishedState(readStoredPreview());
  }, [forcedReadOnly]);

  const setPreviewPublished = useCallback((nextPreviewPublished: boolean) => {
    if (forcedReadOnly) {
      setPreviewPublishedState(false);
      return;
    }

    setPreviewPublishedState(nextPreviewPublished);
    window.sessionStorage.setItem(STORAGE_KEY, String(nextPreviewPublished));
  }, [forcedReadOnly]);

  return {
    previewPublished: forcedReadOnly ? false : previewPublished,
    effectiveReadOnly: forcedReadOnly || previewPublished,
    canTogglePreview: !forcedReadOnly,
    setPreviewPublished,
  };
}
