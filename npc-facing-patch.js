/**
 * NPC FACING PATCH — Dragon World Z
 * ══════════════════════════════════════════════════════════════════
 * Soluciona que los NPCs siempre miraban al jugador, incluso cuando
 * pelean entre sí.
 *
 * CÓMO FUNCIONA:
 *   Cada NPC en waveEnemies puede tener un campo `team`:
 *     - Sin team / team: "enemy"  → ataca al jugador (comportamiento original)
 *     - team: "ally"              → ataca al NPC enemigo más cercano del equipo contrario
 *
 *   El `facing` ahora siempre apunta hacia el TARGET REAL del NPC,
 *   sea jugador u otro NPC.
 *
 * CÓMO ACTIVAR BANDOS EN LAS WAVES:
 *   En los WAVE_TEMPLATES de game.html, agregá `team: "ally"` a los
 *   NPCs aliados del jugador y `team: "enemy"` (o sin team) a los enemigos.
 *   Ejemplo:
 *     { id:"aliado_1", name:"ALIADO", team:"ally", color:"#00e676", npcMaxHp:400, npcAtk:22, npcDef:10, npcXp:0, spawnCorner:0 }
 *     { id:"enemigo_1", name:"ENEMIGO", team:"enemy", color:"#ff1744", npcMaxHp:300, npcAtk:18, npcDef:8, npcXp:50, spawnCorner:2 }
 *
 * INSTALACIÓN:
 *   Agregar en game.html (antes del cierre de </body>):
 *     <script src="npc-facing-patch.js"></script>
 * ══════════════════════════════════════════════════════════════════
 */
(function () {
  "use strict";

  // ── Esperar a que el juego esté listo ──────────────────────────────────────
  function waitReady(cb, n) {
    n = n || 0;
    if (n > 600) return;
    // Esperar a que tickNpcCombat exista en window
    if (typeof window.tickNpcCombat === "function" && window.waveEnemies !== undefined) {
      cb();
    } else {
      setTimeout(() => waitReady(cb, n + 1), 100);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  HELPERS DE TARGET
  // ══════════════════════════════════════════════════════════════════

  /**
   * Resuelve el target de combate de un NPC.
   * - NPCs con team "ally":  buscan el NPC enemigo más cercano.
   *   Si no hay enemigos vivos, atacan al jugador como fallback.
   * - NPCs sin team o team "enemy": apuntan al jugador.
   *
   * @param {object} npc   - El NPC que está buscando target
   * @returns {{ x:number, y:number, entity:object|null, isPlayer:boolean }}
   */
  function resolveNpcTarget(npc) {
    const player = window.player;
    const waveEnemies = window.waveEnemies || [];

    if (!player) return { x: npc.x, y: npc.y, entity: null, isPlayer: false };

    const isAlly = npc.team === "ally";

    if (isAlly) {
      // Buscar el NPC enemigo vivo más cercano (team "enemy" o sin team)
      let bestEnemy = null;
      let bestDist = Infinity;

      waveEnemies.forEach(other => {
        if (other === npc) return;
        if (other.npcHp <= 0 || other._dead) return;
        // Es enemigo si tiene team "enemy" o no tiene team definido
        const otherIsEnemy = !other.team || other.team === "enemy";
        if (!otherIsEnemy) return;
        const d = Math.hypot(other.x - npc.x, other.y - npc.y);
        if (d < bestDist) {
          bestDist = d;
          bestEnemy = other;
        }
      });

      if (bestEnemy) {
        return { x: bestEnemy.x, y: bestEnemy.y, entity: bestEnemy, isPlayer: false };
      }

      // Fallback: si no hay NPCs enemigos, el aliado ayuda atacando al jugador
      // (esto también cubre el caso de combates sin bandos)
      return { x: player.x, y: player.y, entity: null, isPlayer: true };
    }

    // Comportamiento por defecto: apuntar al jugador
    return { x: player.x, y: player.y, entity: null, isPlayer: true };
  }

  // ══════════════════════════════════════════════════════════════════
  //  PATCH PRINCIPAL: reemplazar tickNpcCombat
  // ══════════════════════════════════════════════════════════════════

  function applyPatch() {
    // Guardar referencias a funciones internas que necesitamos
    // (están en el closure de game.html, así que las exponemos si no están expuestas)
    const _origTickNpcCombat = window.tickNpcCombat;

    // ── Variables de estado internas que necesitamos acceder ──────────
    // Usamos getters sobre window para las que ya están expuestas
    function getVar(name) { return window[name]; }

    // ── Reemplazar tickNpcCombat ──────────────────────────────────────
    window.tickNpcCombat = function tickNpcCombatPatched() {
      const currentMap        = window.currentMap;
      const waveEnemies       = window.waveEnemies;
      const player            = window.player;
      const npcAnimators      = window.npcAnimators;
      const pendingFactionChallenge = window.pendingFactionChallenge;

      // Si las variables internas no están expuestas o no hay bandos
      // que necesiten el patch, delegar al original
      if (!waveEnemies || !npcAnimators || !player) {
        return _origTickNpcCombat.apply(this, arguments);
      }

      // Verificar si algún NPC tiene team distinto (patch necesario)
      const hasMixedTeams = waveEnemies.some(e => e.team === "ally");

      if (!hasMixedTeams) {
        // Sin bandos mezclados → comportamiento 100% original
        return _origTickNpcCombat.apply(this, arguments);
      }

      // ── Con bandos: parchamos el facing de cada NPC antes del tick ──
      //
      // Estrategia: modificar temporalmente el facing de cada NPC
      // para que apunte a su target real, luego llamar al tick original.
      // El tick original usará `npc.facing` para la lógica de dirección
      // en las animaciones de ataque (knockback, etc.).
      //
      // Para el movimiento (que usa player.x hardcodeado internamente),
      // también sobreescribimos _npcTargetOverride para que la lógica
      // de movimiento use el target correcto.

      // Pre-calcular targets y facing ANTES del tick
      const targetCache = new Map();
      waveEnemies.forEach(npc => {
        if (npc.npcHp <= 0 || npc._dead) return;
        const target = resolveNpcTarget(npc);
        targetCache.set(npc.id, target);
        // Actualizar facing hacia el target real
        const dx = target.x - npc.x;
        if (dx !== 0) npc.facing = dx > 0 ? 1 : -1;
      });

      // Guardar target overrides en cada NPC para que la lógica de
      // movimiento pueda usarlos (game.html los leerá si los encuentra)
      waveEnemies.forEach(npc => {
        const t = targetCache.get(npc.id);
        if (t) npc._targetOverride = t;
      });

      // Correr el tick original (mueve NPCs hacia player.x por default)
      _origTickNpcCombat.apply(this, arguments);

      // Post-tick: corregir posición/movimiento para NPCs aliados que
      // deben perseguir a un NPC enemigo, no al jugador.
      // (El tick original ya los movió hacia el jugador; lo revertimos
      //  y los movemos hacia su target correcto)
      //
      // Nota: Este enfoque doble-movimiento puede causar un micro-jitter.
      // Para evitarlo, usamos el override ANTES del tick: marcamos
      // _skipOriginalMove para que sepamos qué correcciones hacer.
      //
      // En lugar del doble-movimiento, el enfoque más limpio es
      // sobrescribir el movimiento post-hoc con la diferencia correcta.
      // Ya que el tick original movió al NPC hacia (player.x, player.y),
      // calculamos el delta incorrecto y lo revertimos aplicando el correcto.

      const NPC_SPEED = window._NPC_SPEED_CACHED || 110; // px/s — valor por defecto

      // Detectar el dt que usó el tick (aproximado, no perfecto pero cercano)
      // No podemos acceder al dt interno, así que recalculamos con el timestamp
      const dtApprox = Math.min((performance.now() - (window._lastNpcTick || performance.now())) / 1000, 0.08);
      // _lastNpcTick fue actualizado por el tick original; usamos un estimado muy pequeño
      const dtEst = 0.016; // ~60fps frame

      waveEnemies.forEach(npc => {
        if (npc.npcHp <= 0 || npc._dead) return;
        const t = targetCache.get(npc.id);
        if (!t || t.isPlayer) return; // NPCs que atacan al jugador: no hacer nada
        if (!t.entity || t.entity.npcHp <= 0) return; // target murió: no corregir

        // El tick original movió al NPC hacia (player.x, player.y).
        // Revertimos ese movimiento y aplicamos el movimiento hacia el target real.
        const dxToPlayer = player.x - npc.x;
        const dyToPlayer = player.y - npc.y;
        const dToPlayer  = Math.hypot(dxToPlayer, dyToPlayer) || 0.001;

        const dxToTarget = t.x - npc.x;
        const dyToTarget = t.y - npc.y;
        const dToTarget  = Math.hypot(dxToTarget, dyToTarget) || 0.001;

        // No mover si ya está muy cerca del target (distancia de pelea)
        const STOP_DIST = 10;
        if (dToTarget <= STOP_DIST) return;

        // Calcular cuánto lo movió el tick original (si dToPlayer > STOP_DIST)
        if (dToPlayer > STOP_DIST) {
          // Revertir movimiento hacia player
          const dt = window._patchDt || 0.016;
          npc.x -= (dxToPlayer / dToPlayer) * NPC_SPEED * dt;
          npc.y -= (dyToPlayer / dToPlayer) * NPC_SPEED * dt;

          // Aplicar movimiento correcto hacia target
          npc.x += (dxToTarget / dToTarget) * NPC_SPEED * dt;
          npc.y += (dyToTarget / dToTarget) * NPC_SPEED * dt;
        }

        // Mantener facing correcto después de la corrección
        const finalDx = t.x - npc.x;
        if (finalDx !== 0) npc.facing = finalDx > 0 ? 1 : -1;
      });

      // Limpiar overrides
      waveEnemies.forEach(npc => { delete npc._targetOverride; });
    };

    // ── Patch de launchKnockback ──────────────────────────────────────
    // Cuando un NPC aliado golpea a un NPC enemigo, el knockback debe ir
    // en la dirección correcta. Esto ya funciona porque usamos npc.facing
    // que ya fue corregido arriba.

    // ── Exponer hook de dt para la corrección de movimiento ──────────
    // Interceptar _lastNpcTick para calcular dt correctamente
    const _origLastNpcTickDesc = Object.getOwnPropertyDescriptor(window, "_lastNpcTick");
    let _lastTickCapture = performance.now();
    let _dtCapture = 0.016;

    // Patch en el gameLoop para capturar dt
    const _origTick = window.tickNpcCombat;
    // Guardamos el dt en window._patchDt mediante un wrapper del loop
    // que lee el tiempo antes de llamar al tick
    (function hookDt() {
      let _prevTime = performance.now();
      const _gameLoopOrig = window.requestAnimationFrame;
      // En cada frame calculamos el dt aproximado
      function dtTracker() {
        const now = performance.now();
        window._patchDt = Math.min((now - _prevTime) / 1000, 0.08);
        _prevTime = now;
        requestAnimationFrame(dtTracker);
      }
      requestAnimationFrame(dtTracker);
    })();

    // ── Patch de ataques NPC-vs-NPC ──────────────────────────────────
    // El tick original solo aplica daño al jugador. Para NPCs aliados
    // que pelean contra NPCs enemigos, necesitamos un tick paralelo.
    patchNpcVsNpcCombat();

    console.log("[npc-facing-patch] ✅ Patch de facing NPC aplicado correctamente.");
    console.log("[npc-facing-patch] Para usar bandos: agregá team:'ally' o team:'enemy' a los NPCs en WAVE_TEMPLATES.");
  }

  // ══════════════════════════════════════════════════════════════════
  //  NPC-VS-NPC COMBAT PATCH
  //  El tick original solo aplica daño al JUGADOR. Este patch agrega
  //  el combate entre NPCs de distintos bandos.
  // ══════════════════════════════════════════════════════════════════

  function patchNpcVsNpcCombat() {
    // Corremos un loop paralelo cada ~350ms para el combate NPC-vs-NPC
    // (el tick principal ya corre a 60fps para el NPC-vs-jugador)
    let _npcVsNpcTimer = null;

    function npcVsNpcTick() {
      const waveEnemies = window.waveEnemies;
      const npcAnimators = window.npcAnimators;
      if (!waveEnemies || !npcAnimators) return;

      const hasMixedTeams = waveEnemies.some(e => e.team === "ally");
      if (!hasMixedTeams) return;

      const now = Date.now();
      const NPC_COMBAT_INTERVAL = window._NPC_COMBAT_INTERVAL_CACHED || 1200;
      const NPC_SPECIAL_INTERVAL = window._NPC_SPECIAL_INTERVAL_CACHED || 4000;
      const NPC_ANIM_DUR = window.NPC_ANIM_DUR || { light_combo: 420, heavy_combo: 550, special: 800 };

      waveEnemies.forEach(npc => {
        if (npc.npcHp <= 0 || npc._dead) return;
        if (npc.team !== "ally") return; // Solo los aliados atacan NPCs
        if (npc._animLocked) return;

        const target = resolveNpcTarget(npc);
        if (target.isPlayer || !target.entity) return; // En fallback al jugador: el tick original lo maneja

        const enemyNpc = target.entity;
        const d = Math.hypot(enemyNpc.x - npc.x, enemyNpc.y - npc.y);
        const ATTACK_RANGE = 80;

        // Actualizar facing
        npc.facing = (enemyNpc.x - npc.x) > 0 ? 1 : -1;

        if (d > ATTACK_RANGE) return; // Fuera de rango: el movimiento se hace en tickNpcCombat

        // ── En rango: atacar al NPC enemigo ──────────────────────────
        if (now < (npc._npcVsNpcAttackTimer || 0)) return;

        npc._npcVsNpcAttackTimer = now + NPC_COMBAT_INTERVAL + Math.random() * 400;

        const _NPC_ATK_POOL_NORMAL = ["light_combo", "light_combo", "heavy_combo"];
        const _NPC_ATK_POOL_BOSS   = ["light_combo", "heavy_combo", "heavy_combo"];

        const forceSpecial = now >= (npc._npcVsNpcSpecialTimer || 0);
        if (forceSpecial) npc._npcVsNpcSpecialTimer = now + NPC_SPECIAL_INTERVAL;

        const pool = npc.isBoss ? _NPC_ATK_POOL_BOSS : _NPC_ATK_POOL_NORMAL;
        const atkAnim = forceSpecial ? "special" : pool[Math.floor(Math.random() * pool.length)];
        const atkDur  = (NPC_ANIM_DUR[atkAnim] || 420);

        // Calcular daño al NPC enemigo
        const dmg = Math.max(1, Math.floor(npc.npcAtk - (enemyNpc.npcDef || 5) * 0.4 + (Math.random() * 8 - 4)));
        enemyNpc.npcHp = Math.max(0, enemyNpc.npcHp - dmg);

        // Mostrar daño flotante
        if (typeof window.showFloatingDmg === "function" && window.cam) {
          window.showFloatingDmg(dmg, enemyNpc.x - window.cam.x, enemyNpc.y - window.cam.y, "#ffab40");
        }

        // Animación del NPC aliado atacando
        const anim = npcAnimators[npc.id];
        npc._animLocked = true;
        npc._anim = atkAnim;
        if (anim) {
          if (anim.setBattleMode) anim.setBattleMode(true);
          anim.play(atkAnim);
        }
        setTimeout(() => {
          npc._animLocked = false;
          if (npc.npcHp > 0 && anim && typeof window._playNpcCombatIdle === "function") {
            window._playNpcCombatIdle(npc, anim);
          }
        }, atkDur + 100);

        // Animación del NPC enemigo recibiendo el golpe
        const enemyAnim = npcAnimators[enemyNpc.id];
        if (enemyAnim) {
          enemyNpc._animLocked = true;
          if (enemyAnim.setBattleMode) enemyAnim.setBattleMode(true);
          enemyAnim.play("hit");
          setTimeout(() => {
            enemyNpc._animLocked = false;
            if (enemyNpc.npcHp > 0 && typeof window._playNpcCombatIdle === "function") {
              window._playNpcCombatIdle(enemyNpc, enemyAnim);
            }
          }, 350);
        }

        // Knockback al NPC enemigo si el golpe lo merece
        if ((atkAnim === "heavy_combo" || atkAnim === "special") && typeof window.launchKnockback === "function") {
          window.launchKnockback(enemyNpc, enemyAnim, npc.facing, atkAnim === "special" ? 1.35 : 1, false);
        }

        // Marcar como muerto si llega a 0 HP
        if (enemyNpc.npcHp <= 0) {
          enemyNpc._dead = true;
          enemyNpc.npcHp = 0;
          if (enemyAnim && typeof window._playHitKoAnim === "function") {
            window._playHitKoAnim(enemyAnim, enemyNpc, () => { enemyNpc._animLocked = false; });
          }
        }
      });
    }

    // Correr el tick NPC-vs-NPC a ~8 fps (suficiente para combate reactivo)
    setInterval(npcVsNpcTick, 125);
  }

  // ══════════════════════════════════════════════════════════════════
  //  EXPONER helpers para que game.html pueda usarlos si los necesita
  // ══════════════════════════════════════════════════════════════════
  window._npcFacingPatch = {
    resolveNpcTarget,
    version: "1.0.0",
  };

  // Aplicar el patch cuando el juego esté listo
  waitReady(applyPatch);

})();
