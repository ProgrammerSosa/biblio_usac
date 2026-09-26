import axiosClient from '../../shared/api/axiosClient';

export const catalogApi = {
  list: (params) => axiosClient.get('/catalog', { params }),
  getById: (id) => axiosClient.get(`/catalog/${id}`),
  create: (data) => axiosClient.post('/catalog', data),
  update: (id, data) => axiosClient.patch(`/catalog/${id}`, data),
  revisar: (id, data) => axiosClient.patch(`/catalog/${id}/revisar`, data),
  darDeBaja: (id, motivo) => axiosClient.patch(`/catalog/${id}/dar-de-baja`, { motivo }),
  aprobarLote: (ids) => axiosClient.patch('/catalog/aprobar-lote', { ids }),
  rechazarLote: (ids, observaciones) => axiosClient.patch('/catalog/rechazar-lote', { ids, observaciones }),
  enviarLote: (ids) => axiosClient.patch('/catalog/enviar-lote', { ids }),
  remove: (id) => axiosClient.delete(`/catalog/${id}`),
  exportPdf: (params) => axiosClient.get('/exports/catalog', { params, responseType: 'blob' }),
  importarPrevisualizar: (archivo) => {
    const formData = new FormData();
    formData.append('archivo', archivo);
    return axiosClient.post('/catalog/importar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  importarConfirmar: (items, archivoOrigen) => axiosClient.post('/catalog/importar/confirmar', { items, archivoOrigen }),
};
