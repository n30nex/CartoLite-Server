import type { PacketKind } from './trafficVisuals';

export type NodeRole = 'repeater' | 'companion' | 'room_server' | 'sensor' | 'unknown';

export interface EndpointV2 {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface NodeV2 extends EndpointV2 {
  role: NodeRole;
  observer: boolean;
  lastSeen: number;
}

export interface RouteV2 {
  id: string;
  fromId: string;
  toId: string;
  packetCount: number;
  lastHeard: number;
  intensity: 0 | 1 | 2 | 3 | 4;
  lastKind: PacketKind;
  traffic: number;
}

export interface StatusV2 {
  feed: 'connected' | 'disconnected';
  activity: 'active' | 'quiet';
  lastPacketAt?: number;
  dropped: number;
  version: string;
  gitSha: string;
}

export interface StateV2 {
  schemaVersion: 2;
  bootId: string;
  seq: number;
  serverTime: number;
  status: StatusV2;
  map: { center: [number, number]; zoom: number };
  nodes: NodeV2[];
  routes: RouteV2[];
}

export interface RouteSegmentEventV2 {
  routeId: string;
  fromId: string;
  toId: string;
}

interface PacketBaseV2 {
  seq: number;
  id: string;
  at: number;
  payloadType: PacketKind;
}

export interface RoutePacketEventV2 extends PacketBaseV2 {
  mode: 'route';
  segments: RouteSegmentEventV2[];
}

export interface ObserverPacketEventV2 extends PacketBaseV2 {
  mode: 'observer';
  observer: EndpointV2;
}

export type PacketEventV2 = RoutePacketEventV2 | ObserverPacketEventV2;

export interface RouteSegmentView {
  routeId: string;
  from: EndpointV2;
  to: EndpointV2;
}

export interface RoutePacketView extends PacketBaseV2 {
  mode: 'route';
  segments: RouteSegmentView[];
}

export type PacketView = RoutePacketView | ObserverPacketEventV2;
export type HelloV2 = { seq: number; bootId: string };
export type NodeEventV2 = { seq: number; node: NodeV2 };
export type StatusEventV2 = { seq: number; status: StatusV2 };
export type ResetV2 = { seq: number; bootId: string };
