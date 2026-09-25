/**
 * Test probe for engine-held state ownership.
 *
 * The activities engine keeps its authoritative state inside a live object rather
 * than in the proxied world-state graph, so its protection comes from
 * `SystemScope.assertOwner`. This probe exercises exactly that mechanism with a
 * minimal stand-in, keeping the ownership test independent of scheduler detail.
 */

import type { SystemScope } from "../../src/engine/core/access.ts";

export class EntitiesActivityProbe {
  private readonly scope: SystemScope;
  private touches = 0;

  constructor(scope: SystemScope) {
    this.scope = scope;
  }

  touch(): number {
    this.scope.assertOwner("activities");
    this.touches += 1;
    return this.touches;
  }

  count(): number {
    return this.touches;
  }
}
