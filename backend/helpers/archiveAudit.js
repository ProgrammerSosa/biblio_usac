const Audit = require('../src/audit/audit_model');
const AuditArchive = require('../src/audit/auditArchive_model');

const DIAS_ANTES_DE_ARCHIVAR = 30;
const INTERVALO_MS = 24 * 60 * 60 * 1000; // revisa una vez al dia

async function archivarAuditoriaVieja() {
  const limite = new Date(Date.now() - DIAS_ANTES_DE_ARCHIVAR * 24 * 60 * 60 * 1000);
  const viejos = await Audit.find({ fecha: { $lt: limite } });

  if (viejos.length === 0) return 0;

  await AuditArchive.insertMany(
    viejos.map((doc) => doc.toObject()),
    { ordered: false }
  );
  await Audit.deleteMany({ _id: { $in: viejos.map((doc) => doc._id) } });

  console.log(`Auditoria: se archivaron ${viejos.length} registro(s) de mas de ${DIAS_ANTES_DE_ARCHIVAR} dias.`);
  return viejos.length;
}

function startAuditArchiving() {
  const ejecutar = () => {
    archivarAuditoriaVieja().catch((err) => console.error('Error archivando auditoria:', err.message));
  };

  ejecutar();
  setInterval(ejecutar, INTERVALO_MS);
}

module.exports = { startAuditArchiving, archivarAuditoriaVieja, DIAS_ANTES_DE_ARCHIVAR };
