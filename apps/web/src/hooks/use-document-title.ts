import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · CardOps`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
