const request = require('supertest');

function api(app) {
  return {
    get: (url) => request(app).get(url),
    post: (url) => request(app).post(url),
    patch: (url) => request(app).patch(url),
    delete: (url) => request(app).delete(url),
  };
}

module.exports = { api };
