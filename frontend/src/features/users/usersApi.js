import axiosClient from '../../shared/api/axiosClient';

export const usersApi = {
  list: () => axiosClient.get('/users'),
  listInvitations: () => axiosClient.get('/users/invitations'),
  invite: (data) => axiosClient.post('/users/invitations', data),
  setEstado: (id, activo) => axiosClient.patch(`/users/${id}/estado`, { activo }),
};
