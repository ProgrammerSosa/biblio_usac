import { useContext } from 'react';
import { CategoriesContext } from '../CategoriesContext';

export function useCategories() {
  const ctx = useContext(CategoriesContext);
  if (!ctx) {
    throw new Error('useCategories debe usarse dentro de <CategoriesProvider>');
  }
  return ctx;
}
