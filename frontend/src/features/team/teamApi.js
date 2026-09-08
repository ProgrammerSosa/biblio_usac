import axiosClient from '../../shared/api/axiosClient';

export const teamApi = {
  listEstadisticas: () => axiosClient.get('/team'),
  getPerfil: (id) => axiosClient.get(`/team/${id}/perfil`),
};
