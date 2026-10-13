import type { NativeBinding } from "../../../../src/main/native.js";
import type { IslandEvent } from "../../../../src/shared/nodes.js";
import type { Capabilities } from "../../../../src/shared/types.js";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Decodes a JSON string the code under test handed to the addon. */
export function decode(text: string): Json {
  // JSON.parse is the boundary: its result is any JSON value.
  return JSON.parse(text) as Json;
}

type Method = keyof NativeBinding;
type Calls = { [Name in Method]: Array<Parameters<NativeBinding[Name]>> };

export const GLASS_CAPABILITIES: Omit<Capabilities, "platform"> = {
  osVersion: "26.1.0",
  glass: true,
  fallback: false,
  interactiveRegions: false,
  islands: true,
};

/** Stands in for the compiled addon: records every call and hands out increasing ids. */
export class FakeNative implements NativeBinding {
  /** Arguments of every call, per method, in call order. */
  readonly calls: Calls = {
    capabilities: [],
    setEventCallback: [],
    backgroundSet: [],
    groupCreate: [],
    regionCreate: [],
    islandCreate: [],
    objectUpdate: [],
    objectSetFrame: [],
    objectRemove: [],
    islandSetContent: [],
    islandSetValue: [],
    islandFocus: [],
    hostDetach: [],
    hostInspect: [],
  };
  /** Method names in call order, across all methods. */
  readonly log: Method[] = [];
  reported: Partial<Capabilities> = GLASS_CAPABILITIES;
  inspection: string | null = null;
  /** What `islandSetValue` and `islandFocus` answer. */
  found = true;

  #nextId = 1;
  #listener: ((id: number, json: string) => void) | undefined;
  readonly #failures = new Map<Method, Error>();

  /** Makes every later call to `method` throw. */
  failOn(method: Method, error: Error = new Error(`native ${method} failed`)): void {
    this.#failures.set(method, error);
  }

  /** Fires a native event for object `id`, as the addon would. */
  emit(id: number, event: IslandEvent): void {
    this.#listener?.(id, JSON.stringify(event));
  }

  /** The id the most recent create call returned. */
  get lastId(): number {
    return this.#nextId - 1;
  }

  /** The decoded options of every `objectUpdate` call for object `id`. */
  updatesOf(id: number): Json[] {
    return this.calls.objectUpdate.filter(([target]) => target === id).map(([, options]) => decode(options));
  }

  /** The frames set on object `id`, as `[x, y, width, height, seconds]`. */
  framesOf(id: number): Array<[number, number, number, number, number]> {
    return this.calls.objectSetFrame
      .filter(([target]) => target === id)
      .map(([, x, y, width, height, seconds]) => [x, y, width, height, seconds]);
  }

  removed(): number[] {
    return this.calls.objectRemove.map(([id]) => id);
  }

  #enter(method: Method): void {
    this.log.push(method);
    const failure = this.#failures.get(method);
    if (failure) throw failure;
  }

  capabilities(): string {
    this.calls.capabilities.push([]);
    this.#enter("capabilities");
    return JSON.stringify(this.reported);
  }

  setEventCallback(listener: (id: number, json: string) => void): void {
    this.calls.setEventCallback.push([listener]);
    this.#enter("setEventCallback");
    this.#listener = listener;
  }

  backgroundSet(handle: Buffer, options: string): number {
    this.calls.backgroundSet.push([handle, options]);
    this.#enter("backgroundSet");
    return this.#nextId++;
  }

  groupCreate(handle: Buffer, options: string): number {
    this.calls.groupCreate.push([handle, options]);
    this.#enter("groupCreate");
    return this.#nextId++;
  }

  regionCreate(handle: Buffer, groupId: number, options: string): number {
    this.calls.regionCreate.push([handle, groupId, options]);
    this.#enter("regionCreate");
    return this.#nextId++;
  }

  islandCreate(handle: Buffer, options: string): number {
    this.calls.islandCreate.push([handle, options]);
    this.#enter("islandCreate");
    return this.#nextId++;
  }

  objectUpdate(id: number, options: string): void {
    this.calls.objectUpdate.push([id, options]);
    this.#enter("objectUpdate");
  }

  objectSetFrame(id: number, x: number, y: number, width: number, height: number, animateSeconds: number): void {
    this.calls.objectSetFrame.push([id, x, y, width, height, animateSeconds]);
    this.#enter("objectSetFrame");
  }

  objectRemove(id: number): void {
    this.calls.objectRemove.push([id]);
    this.#enter("objectRemove");
  }

  islandSetContent(id: number, content: string, animation: string | null): void {
    this.calls.islandSetContent.push([id, content, animation]);
    this.#enter("islandSetContent");
  }

  islandSetValue(id: number, node: string, value: string): boolean {
    this.calls.islandSetValue.push([id, node, value]);
    this.#enter("islandSetValue");
    return this.found;
  }

  islandFocus(id: number, node: string): boolean {
    this.calls.islandFocus.push([id, node]);
    this.#enter("islandFocus");
    return this.found;
  }

  hostDetach(handle: Buffer): void {
    this.calls.hostDetach.push([handle]);
    this.#enter("hostDetach");
  }

  hostInspect(handle: Buffer): string | null {
    this.calls.hostInspect.push([handle]);
    this.#enter("hostInspect");
    return this.inspection;
  }
}
