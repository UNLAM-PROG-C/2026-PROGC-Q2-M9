/**
 * Evento de respuesta creado por el servidor. La secuencia representa el
 * orden de asignación en el servidor, no el instante de envío del cliente.
 * receivedAt contiene la marca temporal de Date.now() en milisegundos.
 * answer es el valor recibido del cliente; se espera un texto, pero la cola
 * no valida su tipo.
 * @typedef {{
 *   sequence: number,
 *   playerId: string,
 *   roundId: number,
 *   answer: *,
 *   receivedAt: number
 * }} AnswerEvent
 */

/**
 * Cola FIFO de eventos de respuesta de jugadores.
 *
 * Mantiene el orden de inserción y almacena referencias a los eventos.
 * El servidor organiza el drenaje mediante un único consumidor. La cola
 * no implementa bloqueos, espera, ni sincronización entre hilos; tampoco
 * valida los eventos, limita su capacidad ni adjudica puntos.
 */
class AnswerQueue {
  constructor() {
    /** @type {!Array<!AnswerEvent>} */
    this.items = [];
  }

  /**
   * Agrega un evento al final de la cola, sin copiarlo ni validarlo.
   * @param {!AnswerEvent} answerEvent Evento producido por el servidor.
   */
  enqueue(answerEvent) {
    this.items.push(answerEvent);
  }

  /**
   * Retira el evento más antiguo según el orden de inserción.
   * @return {?AnswerEvent} Evento retirado o null si la cola está vacía.
   */
  dequeue() {
    return this.items.shift() || null;
  }

  /**
   * Permite al consumidor decidir si debe continuar drenando la cola.
   * @return {boolean} True si no hay eventos pendientes.
   */
  isEmpty() {
    return this.items.length === 0;
  }

  clear() {
    this.items.length = 0;
  }

  /**
   * @return {number} Cantidad actual de eventos pendientes (no acumulada).
   */
  size() {
    return this.items.length;
  }
}

export {AnswerQueue};
