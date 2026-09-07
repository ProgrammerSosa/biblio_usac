import axiosClient from '../../shared/api/axiosClient';

export const categoriesApi = {
  list: (incluirInactivas = false) => axiosClient.get('/categories', { params: incluirInactivas ? { incluirInactivas: 'true' } : {} }),
  create: (data) => axiosClient.post('/categories', data),
  update: (id, data) => axiosClient.patch(`/categories/${id}`, data),
  setEstado: (id, activo) => axiosClient.patch(`/categories/${id}/estado`, { activo }),
  uso: (id) => axiosClient.get(`/categories/${id}/uso`),
};
