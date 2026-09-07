import axiosClient from '../../shared/api/axiosClient';

export const auditApi = {
  list: (params) => axiosClient.get('/audit', { params }),
  listUsuarios: () => axiosClient.get('/audit/usuarios'),
};
