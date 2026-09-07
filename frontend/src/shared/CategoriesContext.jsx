import { createContext, useCallback, useEffect, useState } from 'react';
import { categoriesApi } from '../features/categories/categoriesApi';

export const CategoriesContext = createContext(null);

export function CategoriesProvider({ children }) {
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await categoriesApi.list();
      setCategorias(res.data.data);
    } catch {
      setCategorias([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const porClave = (clave) => categorias.find((c) => c.clave === clave);
  const etiquetaDe = (clave) => porClave(clave)?.nombre || clave;
  const camposDe = (clave) => porClave(clave)?.campos || [];

  const value = { categorias, loading, recargar: cargar, porClave, etiquetaDe, camposDe };

  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
}
