import axiosClient from '../../shared/api/axiosClient';

export const catalogApi = {
  list: (params) => axiosClient.get('/catalog', { params }),
  getById: (id) => axiosClient.get(`/catalog/${id}`),
  create: (data) => axiosClient.post('/catalog', data),
  update: (id, data) => axiosClient.patch(`/catalog/${id}`, data),
  revisar: (id, data) => axiosClient.patch(`/catalog/${id}/revisar`, data),
  aprobar: (id, data) => axiosClient.patch(`/catalog/${id}/aprobar`, data),
  remove: (id) => axiosClient.delete(`/catalog/${id}`),
  exportPdf: (params) => axiosClient.get('/exports/catalog', { params, responseType: 'blob' }),
};
