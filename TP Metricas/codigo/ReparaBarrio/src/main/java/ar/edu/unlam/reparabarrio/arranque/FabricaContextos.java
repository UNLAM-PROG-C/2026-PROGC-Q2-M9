package ar.edu.unlam.reparabarrio.arranque;

import ar.edu.unlam.reparabarrio.aplicacion.ContextoTaller;
import ar.edu.unlam.reparabarrio.persistencia.*;
import java.nio.file.*;
import java.util.*;

/** Registro de propietarios. Nunca se mantiene su monitor al llamar a una fachada. */
public final class FabricaContextos {
    private static final Map<Path, ContextoTaller> CONTEXTOS = new HashMap<>();
    public record Apertura(ContextoTaller contexto, String codigo, String diagnostico) { }
    private FabricaContextos() { }
    public static Apertura abrirConInforme(Path raiz, InicializadorBase.Solicitud solicitud) {
        try { var c = abrir(raiz, solicitud); return new Apertura(c, c.ciclo().name(), null); }
        catch (Exception e) { return new Apertura(null, e.getMessage() != null && e.getMessage().contains("INSTANCIA_OCUPADA") ? "INSTANCIA_OCUPADA" : "APERTURA_NO_VERIFICADA", e.toString()); }
    }
    public static ContextoTaller abrir(Path raiz, InicializadorBase.Solicitud solicitud) throws Exception {
        Path real = validarRaiz(raiz);
        Path directorio = real.resolve("datos/operativo");
        if (Files.isSymbolicLink(real.resolve("datos")) || Files.isSymbolicLink(directorio)) throw new IllegalArgumentException("Enlace no admitido");
        Files.createDirectories(directorio);
        return componer(directorio, solicitud);
    }
    public static Path validarRaiz(Path raiz) throws Exception {
        if (raiz == null || !raiz.isAbsolute() || raiz.toString().contains(";")) throw new IllegalArgumentException("Raíz absoluta sin parámetros JDBC requerida");
        Path real = raiz.toRealPath();
        if (!Files.isRegularFile(real.resolve("pom.xml")) || !Files.isRegularFile(real.resolve("AGENTS.md")))
            throw new IllegalArgumentException("Raíz de proyecto no acreditada");
        return real;
    }
    private static synchronized ContextoTaller componer(Path directorio, InicializadorBase.Solicitud solicitud) throws Exception {
        Path real = directorio.toRealPath();
        if (Files.isSymbolicLink(real.resolve("taller.mv.db"))) throw new IllegalArgumentException("Base enlazada no admitida");
        var existente = CONTEXTOS.get(real);
        if (existente != null) {
            if (existente.ciclo() == ContextoTaller.Ciclo.CERRADO) CONTEXTOS.remove(real, existente);
            else if (existente.ciclo() == ContextoTaller.Ciclo.CERRANDO) throw new IllegalStateException("CONTEXTO_CERRANDO");
            else return existente;
        }
        var guardia = GuardiaInstancia.adquirir(real);
        try {
            var almacen = PersistenciaH2.preparar(guardia, solicitud);
            var contexto = ContextoTaller.componer(almacen, cerrado -> retirar(real, cerrado));
            CONTEXTOS.put(real, contexto); return contexto;
        } catch (Exception e) { guardia.close(); throw e; }
    }
    private static synchronized void retirar(Path ruta, ContextoTaller propietario) { CONTEXTOS.remove(ruta, propietario); }
    public static synchronized ContextoTaller existente(Path raiz) throws Exception {
        Path ruta = validarRaiz(raiz).resolve("datos/operativo").toRealPath();
        var c = CONTEXTOS.get(ruta);
        if (c == null) throw new IllegalStateException("Apertura explícita/autorización requerida");
        if (c.ciclo() != ContextoTaller.Ciclo.HABILITADO) throw new IllegalStateException("Contexto no habilitado: " + c.ciclo());
        return c;
    }
}
