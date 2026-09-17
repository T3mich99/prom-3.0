import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PROM_BOOTSTRAP_CONFIG, resolvePromBootstrapPaths } from '../excel/prom-catalog-bootstrap.mjs';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function configPath(value) {
  return resolvePromBootstrapPaths({ dbPath: value ?? DEFAULT_PROM_BOOTSTRAP_CONFIG.dbPath }).dbPath;
}

function folderUrl(id) {
  return `https://drive.google.com/drive/folders/${id}`;
}

function normalizeConfig(config) {
  if (!isRecord(config)) throw new TypeError('Google Drive media config must be an object');
  const result = {
    rootFolderId: text(config.rootFolderId),
    productImagesFolderId: text(config.productImagesFolderId),
    finalExcelFolderId: text(config.finalExcelFolderId),
  };
  for (const key of ['rootFolderId', 'productImagesFolderId', 'finalExcelFolderId']) {
    if (!result[key]) throw new TypeError(`Google Drive media config.${key} must be non-empty`);
  }
  for (const key of ['rootFolderUrl', 'productImagesFolderUrl', 'finalExcelFolderUrl']) {
    const value = text(config[key]);
    if (value) {
      let url;
      try { url = new URL(value); } catch { throw new TypeError(`Google Drive media config.${key} must be an absolute HTTPS URL`); }
      if (url.protocol !== 'https:' || !url.hostname) throw new TypeError(`Google Drive media config.${key} must be an absolute HTTPS URL`);
    }
  }
  return {
    ...result,
    rootFolderUrl: text(config.rootFolderUrl) || folderUrl(result.rootFolderId),
    productImagesFolderUrl: text(config.productImagesFolderUrl) || folderUrl(result.productImagesFolderId),
    finalExcelFolderUrl: text(config.finalExcelFolderUrl) || folderUrl(result.finalExcelFolderId),
  };
}

export async function loadRepositoryGoogleDriveMediaConfig({ filePath = fileURLToPath(new URL('../../config/google-drive-media.json', import.meta.url)) } = {}) {
  const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
  return normalizeConfig(saved.drive);
}

async function openConfigDb(dbPath) {
  const absolutePath = configPath(dbPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS prom_drive_media_config (
      config_key TEXT PRIMARY KEY,
      root_folder_id TEXT NOT NULL,
      product_images_folder_id TEXT NOT NULL,
      final_excel_folder_id TEXT NOT NULL,
      root_folder_url TEXT NOT NULL,
      product_images_folder_url TEXT NOT NULL,
      final_excel_folder_url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return { db, absolutePath };
}

export async function saveGoogleDriveMediaConfig(input) {
  if (!isRecord(input)) throw new TypeError('Google Drive media config input must be an object');
  const config = normalizeConfig(input.config);
  const { db, absolutePath } = await openConfigDb(input.dbPath);
  try {
    const timestamp = new Date().toISOString();
    db.prepare(`
      INSERT INTO prom_drive_media_config (
        config_key, root_folder_id, product_images_folder_id, final_excel_folder_id,
        root_folder_url, product_images_folder_url, final_excel_folder_url, updated_at
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(config_key) DO UPDATE SET
        root_folder_id = excluded.root_folder_id,
        product_images_folder_id = excluded.product_images_folder_id,
        final_excel_folder_id = excluded.final_excel_folder_id,
        root_folder_url = excluded.root_folder_url,
        product_images_folder_url = excluded.product_images_folder_url,
        final_excel_folder_url = excluded.final_excel_folder_url,
        updated_at = excluded.updated_at
    `).run(
      config.rootFolderId,
      config.productImagesFolderId,
      config.finalExcelFolderId,
      config.rootFolderUrl,
      config.productImagesFolderUrl,
      config.finalExcelFolderUrl,
      timestamp,
    );
    return { ...config, dbPath: absolutePath, updatedAt: timestamp };
  } finally {
    db.close();
  }
}

export async function loadGoogleDriveMediaConfig(input = {}) {
  if (!isRecord(input)) throw new TypeError('Google Drive media config options must be an object');
  const { db, absolutePath } = await openConfigDb(input.dbPath);
  try {
    const row = db.prepare("SELECT * FROM prom_drive_media_config WHERE config_key = 'default'").get();
    if (!row) return input.fallback ? normalizeConfig(input.fallback) : null;
    return {
      rootFolderId: row.root_folder_id,
      productImagesFolderId: row.product_images_folder_id,
      finalExcelFolderId: row.final_excel_folder_id,
      rootFolderUrl: row.root_folder_url,
      productImagesFolderUrl: row.product_images_folder_url,
      finalExcelFolderUrl: row.final_excel_folder_url,
      dbPath: absolutePath,
      updatedAt: row.updated_at,
    };
  } finally {
    db.close();
  }
}
