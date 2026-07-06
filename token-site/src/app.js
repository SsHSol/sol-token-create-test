// SolFabi - Solana Token-2022 Creator (ESBuild bundled)
import {
  Connection, PublicKey, SystemProgram, Keypair, Transaction,
  TransactionInstruction, LAMPORTS_PER_SOL, Sysvar
} from '@solana/web3.js';

import {
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
} from '@solana/spl-token-metadata';

(function () {
  'use strict';

  // ============================================================
  // Constants
  // ============================================================
  const FEE_WALLET = new PublicKey('3XLxaz1TXbLAqQh5RhfbQW2AcEEGn7tKZTqf88ee8888');
  const FEE_AMOUNT = 0.025 * LAMPORTS_PER_SOL;

  const RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
  ];

  const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

  const DEFAULT_NAME = 'Test Token';
  const DEFAULT_SYMBOL = 'TEST';
  const DEFAULT_DECIMALS = 6;
  const DEFAULT_SUPPLY = 1000000000;

  // ============================================================
  // State
  // ============================================================
  let wallet = null;
  let walletType = null;
  let walletPublicKey = null;
  let connection = null;

  // ============================================================
  // DOM Shortcuts
  // ============================================================
  const $ = (id) => document.getElementById(id);

  // ============================================================
  // Logging
  // ============================================================
  function log(msg, type) {
    const box = $('log-box');
    const div = document.createElement('div');
    div.className = 'log-' + (type || 'info');
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function clearLog() {
    $('log-box').innerHTML = '';
    log('日志已清除', 'info');
  }

  function updateDecimals() {
    const val = $('token-decimals').value;
    $('decimals-display').textContent = val;
  }

  // ============================================================
  // Wallet Detection & Connection
  // ============================================================
  function detectWallet(type) {
    const providers = {
      phantom: () => window.phantom?.solana,
      okx: () => window.okxwallet?.solana,
      backpack: () => window.backpack,
      solflare: () => window.solflare,
      trust: () => window.trustwallet?.solana,
      coinbase: () => window.coinbaseWalletExtension,
      glow: () => window.glow,
      exodus: () => window.exodus?.solana,
    };
    const detect = providers[type];
    if (!detect) return null;
    return detect() || null;
  }

  async function connectWallet(type) {
    try {
      const provider = detectWallet(type);
      if (!provider) {
        log(`${type} 钱包未安装`, 'error');
        return;
      }

      let resp;
      if (provider.connect) {
        resp = await provider.connect();
      } else if (provider.isConnected && !provider.isConnected()) {
        resp = await provider.connect();
      } else {
        resp = { publicKey: provider.publicKey };
      }

      const pubKey = resp.publicKey || provider.publicKey;
      if (!pubKey) {
        log(`${type} 连接失败: 无法获取公钥`, 'error');
        return;
      }

      wallet = provider;
      walletType = type;
      walletPublicKey = pubKey;
      updateWalletUI(type, pubKey);

      log(`✅ 已连接 ${type}: ${pubKey.toBase58()}`, 'success');
      $('create-btn').disabled = false;

      connection = new Connection(RPC_ENDPOINTS[0], { commitment: 'confirmed' });

      try {
        const balance = await connection.getBalance(pubKey);
        log(`💰 余额: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`, 'info');
        if (balance < FEE_AMOUNT + 0.005 * LAMPORTS_PER_SOL) {
          log('⚠️ 余额不足，需要至少 0.03 SOL', 'warning');
        }
      } catch (e) {
        log(`余额查询失败: ${e.message}`, 'warning');
      }
    } catch (err) {
      log(`❌ 连接 ${type} 失败: ${err.message}`, 'error');
      if (err.message && err.message.includes('User rejected')) {
        log('用户取消了连接请求', 'warning');
      }
    }
  }

  function disconnectWallet() {
    if (wallet && wallet.disconnect) {
      try { wallet.disconnect(); } catch (e) { /* ignore */ }
    }
    wallet = null;
    walletType = null;
    walletPublicKey = null;
    $('create-btn').disabled = true;

    document.querySelectorAll('.wallet-btn').forEach(btn => {
      btn.classList.remove('connected');
      btn.querySelector('.wallet-status').textContent = '未连接';
    });

    const addrEl = $('wallet-address');
    addrEl.classList.add('hidden');
    addrEl.textContent = '';
    $('connection-status').textContent = '未连接钱包';
    $('connection-status').className = 'connection-status';
    $('disconnect-btn').style.display = 'none';
    log('钱包已断开', 'info');
  }

  function updateWalletUI(type, pubKey) {
    document.querySelectorAll('.wallet-btn').forEach(btn => {
      const wtype = btn.dataset.wallet;
      if (wtype === type) {
        btn.classList.add('connected');
        btn.querySelector('.wallet-status').textContent = '已连接';
      } else {
        btn.classList.remove('connected');
        btn.querySelector('.wallet-status').textContent = '未连接';
      }
    });

    $('wallet-address').textContent = `地址: ${pubKey.toBase58()}`;
    $('wallet-address').classList.remove('hidden');
    $('connection-status').textContent = `✅ 已连接 ${type}`;
    $('connection-status').className = 'connection-status connected';
    $('disconnect-btn').style.display = 'block';
  }

  // ============================================================
  // Token Creation
  // ============================================================
  async function createToken() {
    if (!wallet || !walletPublicKey) {
      log('请先连接钱包', 'error');
      return;
    }

    const createBtn = $('create-btn');
    createBtn.disabled = true;
    createBtn.textContent = '⏳ 创建中...';

    try {
      // Read form values
      const name = $('token-name').value.trim() || DEFAULT_NAME;
      const symbol = $('token-symbol').value.trim() || DEFAULT_SYMBOL;
      const uri = $('token-uri').value.trim();
      const description = $('token-description').value.trim();
      const decimals = parseInt($('token-decimals').value) || DEFAULT_DECIMALS;
      const supply = parseFloat($('token-supply').value) || 0;
      const referrerStr = $('referrer-wallet').value.trim();
      const memoText = $('memo-text').value.trim();
      const revokeMint = $('revoke-mint').checked;
      const revokeFreeze = $('revoke-freeze').checked;
      const revokeMetadata = $('revoke-metadata').checked;

      const feeWallet = referrerStr
        ? new PublicKey(referrerStr)
        : FEE_WALLET;

      log(`开始创建代币: ${name} (${symbol})`, 'info');
      log(`小数位数: ${decimals}, 供应量: ${supply}`, 'info');
      log(`放弃铸币: ${revokeMint}, 放弃冻结: ${revokeFreeze}, 放弃元数据: ${revokeMetadata}`, 'info');

      // ============================================================
      // Step 1: Create Mint Account
      // ============================================================
      const mintKeypair = Keypair.generate();
      const mintPub = mintKeypair.publicKey;
      log(`Mint 地址: ${mintPub.toBase58()}`, 'info');

      // Token-2022 mint account size with metadata pointer + token metadata
      const MINT_SIZE = 252;
      const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      log(`Mint 租金: ${(mintRent / LAMPORTS_PER_SOL).toFixed(6)} SOL`, 'info');

      // ============================================================
      // Step 2: Build Instructions
      // ============================================================
      const ixs = [];

      // 2a. Create mint account
      ixs.push(
        SystemProgram.createAccount({
          fromPubkey: walletPublicKey,
          newAccountPubkey: mintPub,
          space: MINT_SIZE,
          lamports: mintRent,
          programId: TOKEN_2022_PROGRAM_ID,
        })
      );

      // 2b. Initialize Metadata Pointer
      // BUG FIX: When revokeMetadata is checked, set authority to null immediately
      // so the MetadataPointer can never be changed later.
      // Before fix: authority was always walletPublicKey (never revoked).
      const metadataPointerAuthority = revokeMetadata ? null : walletPublicKey;

      ixs.push(
        createInitializeMetadataPointerInstruction(
          mintPub,
          metadataPointerAuthority,
          mintPub,  // metadata address = mint itself (inline)
          TOKEN_2022_PROGRAM_ID
        )
      );

      // 2c. Initialize Token Metadata (inline in mint account)
      const metadataUpdateAuthority = revokeMetadata ? null : walletPublicKey;

      ixs.push(
        createInitializeInstruction({
          programId: TOKEN_2022_PROGRAM_ID,
          mint: mintPub,
          metadata: mintPub,
          mintAuthority: walletPublicKey,
          updateAuthority: metadataUpdateAuthority,
          name: name,
          symbol: symbol,
          uri: uri || '',
        })
      );

      // 2d. If we have additional metadata (description), add it
      if (description) {
        ixs.push(
          createUpdateFieldInstruction({
            programId: TOKEN_2022_PROGRAM_ID,
            metadata: mintPub,
            updateAuthority: walletPublicKey,
            field: 'description',
            value: description,
          })
        );
      }

      // 2e. Initialize Mint (decimals, mintAuthority, freezeAuthority)
      ixs.push(
        createInitializeMintInstruction(
          mintPub,
          decimals,
          walletPublicKey,                   // mint authority
          revokeFreeze ? null : walletPublicKey,  // freeze authority
          TOKEN_2022_PROGRAM_ID
        )
      );

      // 2f. Mint initial supply to user's ATA
      if (supply > 0) {
        const adjustedSupply = supply * Math.pow(10, decimals);
        const supplyBigInt = BigInt(Math.floor(adjustedSupply));

        // Derive ATA address
        const ata = PublicKey.findProgramAddressSync(
          [walletPublicKey.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mintPub.toBuffer()],
          ASSOCIATED_TOKEN_PROGRAM_ID
        )[0];

        ixs.push(
          createAssociatedTokenAccountInstruction(
            walletPublicKey,   // payer
            ata,              // associated token account
            walletPublicKey,  // owner
            mintPub,          // mint
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );

        ixs.push(
          createMintToInstruction(
            mintPub,
            ata,
            walletPublicKey,
            supplyBigInt,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        );

        log(`将铸造 ${supply} ${symbol} 到您的钱包`, 'info');
      }

      // 2g. Transfer fee to referrer/fee wallet
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: walletPublicKey,
          toPubkey: feeWallet,
          lamports: FEE_AMOUNT,
        })
      );
      log(`手续费 0.025 SOL → ${feeWallet.toBase58()}`, 'info');

      // 2h. Revoke mint authority (if checked)
      if (revokeMint) {
        ixs.push(
          createSetAuthorityInstruction(
            mintPub,
            walletPublicKey,
            AuthorityType.MintTokens,
            null,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        );
        log('🔒 铸币权限已放弃', 'success');
      }

      // 2i. Revoke freeze authority - already handled in initializeMint above
      if (revokeFreeze) {
        log('🔒 冻结权限已放弃 (在初始化时已处理)', 'info');
      }

      // 2j. Revoke metadata - already handled in steps 2b and 2c above
      if (revokeMetadata) {
        log('🔒 元数据权限已放弃 (MetadataPointer + updateAuthority 均在初始化时冻结)', 'success');
      }

      // 2k. Memo instruction
      if (memoText) {
        ixs.push(
          new TransactionInstruction({
            keys: [{ pubkey: walletPublicKey, isSigner: true, isWritable: true }],
            data: Buffer.from(memoText, 'utf8'),
            programId: MEMO_PROGRAM_ID,
          })
        );
      }

      // ============================================================
      // Step 3: Send Transaction
      // ============================================================
      log(`构建交易 (${ixs.length} 个指令)...`, 'info');

      const tx = new Transaction();
      tx.feePayer = walletPublicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      ixs.forEach(ix => tx.add(ix));

      // Sign with wallet + mintKeypair
      let signedTx;
      if (wallet.signTransaction) {
        signedTx = await wallet.signTransaction(tx);
        signedTx.partialSign(mintKeypair);
      } else if (wallet.signAllTransactions) {
        signedTx = await wallet.signTransaction(tx);
        signedTx.partialSign(mintKeypair);
      } else {
        throw new Error('钱包不支持 signTransaction');
      }

      log('📤 发送交易...', 'info');

      const rawTx = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      log(`⏳ 交易已发送: ${signature}`, 'info');

      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        throw new Error(`交易失败: ${JSON.stringify(confirmation.value.err)}`);
      }

      log(`✅ 代币创建成功!`, 'success');
      log(`🔗 https://solscan.io/tx/${signature}`, 'success');
      log(`🪙 Mint: ${mintPub.toBase58()}`, 'success');

      // Record to GitHub (optional)
      try {
        await recordTokenCreation({
          name, symbol, decimals, supply,
          mint: mintPub.toBase58(),
          signature,
          timestamp: new Date().toISOString(),
          revokeMint, revokeFreeze, revokeMetadata,
        });
      } catch (e) {
        log(`记录创建记录失败 (非关键): ${e.message}`, 'warning');
      }
    } catch (err) {
      log(`❌ 创建失败: ${err.message}`, 'error');
      if (err.message && err.message.includes('User rejected')) {
        log('用户取消了签名请求', 'warning');
      } else if (err.message && err.message.includes('insufficient lamports')) {
        log('余额不足，请确保钱包有足够的 SOL', 'error');
      } else if (err.logs) {
        err.logs.forEach(l => log(`  ${l}`, 'error'));
      }
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = '🚀 创建代币 (0.025 SOL)';
    }
  }

  // ============================================================
  // Record Token Creation (GitHub API)
  // ============================================================
  async function recordTokenCreation(data) {
    const GITHUB_TOKEN = '';
    const REPO_OWNER = 'SsHSol';
    const REPO_NAME = 'sol-token-create';
    const FILE_PATH = 'token-creations.json';

    if (!GITHUB_TOKEN) {
      log('未配置 GitHub Token，跳过记录', 'info');
      return;
    }

    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
    const headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    };

    let existingData = [];
    let sha = null;

    try {
      const getResp = await fetch(url, { headers });
      if (getResp.ok) {
        const fileData = await getResp.json();
        sha = fileData.sha;
        const content = atob(fileData.content);
        existingData = JSON.parse(content);
      }
    } catch (e) {
      // File may not exist yet
    }

    existingData.push(data);

    const putResp = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `feat: record token creation ${data.mint}`,
        content: btoa(JSON.stringify(existingData, null, 2)),
        sha: sha || undefined,
      }),
    });

    if (putResp.ok) {
      log('📝 创建记录已保存到 GitHub', 'success');
    } else {
      const errData = await putResp.json();
      throw new Error(errData.message || 'GitHub API error');
    }
  }

  // ============================================================
  // Auto-detect installed wallets on load
  // ============================================================
  function detectInstalledWallets() {
    const types = ['phantom', 'okx', 'backpack', 'solflare', 'trust', 'coinbase', 'glow', 'exodus'];
    types.forEach(type => {
      const provider = detectWallet(type);
      const btn = document.querySelector(`.wallet-btn[data-wallet="${type}"]`);
      if (btn) {
        btn.disabled = !provider;
        if (provider) {
          const status = provider.publicKey ? '可用' : '已安装';
          btn.querySelector('.wallet-status').textContent = status;
        } else {
          btn.querySelector('.wallet-status').textContent = '未安装';
        }
      }
    });
  }

  // ============================================================
  // Public API (exposed to HTML onclick)
  // ============================================================
  window.TokenApp = {
    connectWallet,
    disconnectWallet,
    createToken,
    clearLog,
    updateDecimals,
  };

  // ============================================================
  // Initialize
  // ============================================================
  document.addEventListener('DOMContentLoaded', function () {
    log('🪙 SolFabi Token Creator 已加载', 'info');
    log('请连接钱包开始创建代币', 'info');
    log('使用 Token-2022 标准创建代币', 'info');
    detectInstalledWallets();
    updateDecimals();
  });

})();
