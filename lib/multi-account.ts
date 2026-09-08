import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCOUNTS_KEY = '@vaychat_accounts';
const ACTIVE_ACCOUNT_KEY = '@vaychat_active_account';

export interface StoredAccount {
  userId: string;
  displayName: string;
  phone: string;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function getStoredAccounts(): Promise<StoredAccount[]> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveAccount(account: StoredAccount): Promise<void> {
  const accounts = await getStoredAccounts();
  const index = accounts.findIndex(a => a.userId === account.userId);
  if (index >= 0) {
    accounts[index] = account;
  } else {
    accounts.push(account);
  }
  await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export async function removeAccount(userId: string): Promise<void> {
  const accounts = await getStoredAccounts();
  const filtered = accounts.filter(a => a.userId !== userId);
  await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(filtered));
}

export async function updateAccountProfile(userId: string, updates: { displayName?: string; avatarUrl?: string | null; phone?: string }): Promise<void> {
  const accounts = await getStoredAccounts();
  const index = accounts.findIndex(a => a.userId === userId);
  if (index >= 0) {
    if (updates.displayName !== undefined) accounts[index].displayName = updates.displayName;
    if (updates.avatarUrl !== undefined) accounts[index].avatarUrl = updates.avatarUrl;
    if (updates.phone !== undefined) accounts[index].phone = updates.phone;
    await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }
}

export async function updateAccountTokens(userId: string, accessToken: string, refreshToken: string, expiresAt: number): Promise<void> {
  const accounts = await getStoredAccounts();
  const index = accounts.findIndex(a => a.userId === userId);
  if (index >= 0) {
    accounts[index].accessToken = accessToken;
    accounts[index].refreshToken = refreshToken;
    accounts[index].expiresAt = expiresAt;
    await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }
}

export async function getActiveAccountId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ACTIVE_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export async function setActiveAccountId(userId: string): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_ACCOUNT_KEY, userId);
}
