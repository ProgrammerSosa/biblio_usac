import axiosClient from '../../shared/api/axiosClient';

export const backupApi = {
  exportar: () => axiosClient.get('/backup/exportar', { responseType: 'blob' }),
  restaurar: (archivo) => {
    const formData = new FormData();
    formData.append('archivo', archivo);
    return axiosClient.post('/backup/restaurar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
