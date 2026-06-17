import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";

// ===========================================================================
// Org config (singleton)
// ===========================================================================

export async function getOrgConfig(): Promise<Record<string, unknown> | null> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.orgConfig).findOne({ _id: "org" as any });
}

export async function upsertOrgConfig(config: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.orgConfig).updateOne(
      { _id: "org" as any },
      { $set: { ...config, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertOrgConfig failed: ${msg}`);
  }
}

// ===========================================================================
// Group configs
// ===========================================================================

export async function getGroupConfig(groupId: string): Promise<Record<string, unknown> | null> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.groupConfigs).findOne({ groupId });
}

export async function listGroupConfigs(): Promise<Array<Record<string, unknown>>> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.groupConfigs).find({}).sort({ groupId: 1 }).toArray();
}

export async function upsertGroupConfig(groupId: string, config: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.groupConfigs).updateOne(
      { groupId },
      { $set: { ...config, groupId, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertGroupConfig failed (${groupId}): ${msg}`);
  }
}

export async function deleteGroupConfig(groupId: string): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.groupConfigs).deleteOne({ groupId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteGroupConfig failed (${groupId}): ${msg}`);
  }
}

// ===========================================================================
// Override configs
// ===========================================================================

export async function getOverrideConfig(overrideId: string): Promise<Record<string, unknown> | null> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.overrideConfigs).findOne({ overrideId });
}

export async function listOverrideConfigs(): Promise<Array<Record<string, unknown>>> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.overrideConfigs).find({}).sort({ overrideId: 1 }).toArray();
}

export async function upsertOverrideConfig(overrideId: string, config: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.overrideConfigs).updateOne(
      { overrideId },
      { $set: { ...config, overrideId, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertOverrideConfig failed (${overrideId}): ${msg}`);
  }
}

export async function deleteOverrideConfig(overrideId: string): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.overrideConfigs).deleteOne({ overrideId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteOverrideConfig failed (${overrideId}): ${msg}`);
  }
}

// ===========================================================================
// Scheduler config (singleton)
// ===========================================================================

export async function getSchedulerConfig(): Promise<Record<string, unknown> | null> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.schedulerConfig).findOne({ _id: "scheduler" as any });
}

export async function upsertSchedulerConfig(config: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.schedulerConfig).updateOne(
      { _id: "scheduler" as any },
      { $set: { ...config, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertSchedulerConfig failed: ${msg}`);
  }
}
