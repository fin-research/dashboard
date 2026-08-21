import type { BondLedgerRecord } from "./types";

const DATABASE_NAME = "eastmoney-bond-ledger";
const DATABASE_VERSION = 1;
const STORE_NAME = "daily-ledgers";

export async function listBondLedgers(): Promise<BondLedgerRecord[]> {
  const database = await openDatabase();
  try {
    const records = await requestResult<BondLedgerRecord[]>(
      database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll(),
    );
    return records.sort((left, right) => left.date.localeCompare(right.date));
  } finally {
    database.close();
  }
}

export async function putBondLedger(record: BondLedgerRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteLocalBondLedger(date: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(date);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "date" });
        store.createIndex("uploadedAt", "uploadedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开浏览器台账数据库"));
    request.onblocked = () => reject(new Error("浏览器台账数据库正在被占用"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("浏览器台账数据库读取失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("浏览器台账数据库写入失败"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("浏览器台账数据库写入已取消"));
  });
}
