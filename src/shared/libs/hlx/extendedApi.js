import get from 'lodash/get';
import has from 'lodash/has';
import includes from 'lodash/includes';
import map from 'lodash/map';
import orderBy from 'lodash/orderBy';
import isEmpty from 'lodash/isEmpty';
import { composeAPI } from '@helixnetwork/core';
import { asTransactionStrings } from '@helixnetwork/transaction-converter';
import { helix, quorum } from './index';
import Errors from '../errors';
import {
    DEFAULT_BALANCES_THRESHOLD,
    DEFAULT_DEPTH,
    DEFAULT_MIN_WEIGHT_MAGNITUDE,
    DEFAULT_NODE_REQUEST_TIMEOUT,
    GET_NODE_INFO_REQUEST_TIMEOUT,
    WERE_ADDRESSES_SPENT_FROM_REQUEST_TIMEOUT,
    GET_BALANCES_REQUEST_TIMEOUT,
    ATTACH_TO_TANGLE_REQUEST_TIMEOUT,
    GET_TRANSACTIONS_TO_APPROVE_REQUEST_TIMEOUT,
    IRI_API_VERSION,
    MAX_MILESTONE_FALLBEHIND,
} from '../../config';
import {
    sortTransactionTxBytesArray,
    constructBundleFromAttachedTxBytes,
    isBundle,
    isBundleTraversable,
} from './transfers';
import { withRequestTimeoutsHandler } from './utils';

/**
 * Returns timeouts for specific quorum requests
 *
 * @method getApiTimeout
 * @param {string} method
 * @param {array} [payload]

 * @returns {number}
 */

const getApiTimeout = (method) => {
    switch (method) {
        case 'wereAddressesSpentFrom':
            return WERE_ADDRESSES_SPENT_FROM_REQUEST_TIMEOUT;
        case 'getBalances':
            return GET_BALANCES_REQUEST_TIMEOUT;
        case 'getNodeInfo':
            return GET_NODE_INFO_REQUEST_TIMEOUT;
        case 'attachToTangle':
            return ATTACH_TO_TANGLE_REQUEST_TIMEOUT;
        case 'getTransactionsToApprove':
            return GET_TRANSACTIONS_TO_APPROVE_REQUEST_TIMEOUT;
        default:
            return DEFAULT_NODE_REQUEST_TIMEOUT;
    }
};

/**
 * Returns a new HELIX instance if provider is passed, otherwise returns the global instance
 *
 * @method getHelixInstance
 * @param {object} [settings]
 *
 * @returns {object} HELIX instance
 */
const getHelixInstance = (settings, requestTimeout = DEFAULT_NODE_REQUEST_TIMEOUT) => {
    if (settings) {
        const { url } = settings;
        const instance = composeAPI({
            provider: url,
            timeout: requestTimeout,
        });

        return instance;
    }

    return helix;
};

/**
 * Helix getBalances
 *
 * @method getBalances
 * @param {object} [settings]
 * @param {boolean} [withQuorum]
 *
 * @returns {function(array, number): Promise<object>}
 */
const getBalances = (settings, withQuorum = true) => (addresses, threshold = DEFAULT_BALANCES_THRESHOLD) =>
    withQuorum
        ? quorum.getBalances(addresses, threshold).catch((err) => {
              throw new Error(err);
          })
        : getHelixInstance(settings, getApiTimeout('getBalances'))
              .getBalances(addresses, threshold)
              .catch((err) => {
                  throw new Error(err);
              });

/**
 * helix getNodeInfoApi
 *
 * @method getNodeInfo
 * @param {object} [settings]
 *
 * @returns {function(): Promise<object>}
 */
const getNodeInfo = (settings) => () =>
    getHelixInstance(settings, getApiTimeout('getNodeInfo'))
        .getNodeInfo()
        .catch((err) => {
            throw new Error(err);
        });

/**
 * Helix getTransactionsObjects
 *
 * @method getTransactionsObjects
 *
 * @returns {function(array): Promise<any>}
 */
const getTransactionsObjects = (settings) => (hashes) =>
    getHelixInstance(settings)
        .getTransactionObjects(hashes)
        .catch((err) => {
            throw new Error(err);
        });

// TODO : Check if fintransaction objects to be used the new dedicated helix method
/**
 * Helix findTransactionObjects
 *
 * @method findTransactionObjects
 * @param {object} [settings]
 *
 * @returns {function(object): Promise<any>}
 */
const findTransactionObjects = (settings) => (args) =>
    findTransactions(settings)(args)
        .then((hashes) => getTransactionsObjects(settings)(hashes))
        .catch((err) => {
            throw new Error(err);
        });

/**
 * Helix findTransactions
 *
 * @method findTransactions
 * @param {object} [settings]
 *
 * @returns {function(object): Promise<array>}
 */
const findTransactions = (settings) => (args) =>
    getHelixInstance(settings)
        .findTransactions(args)
        .catch((err) => {
            throw new Error(err);
        });

/**
 * Helix getLatestInclusion
 *
 * @method getLatestInclusion
 * @param {object} [settings]
 * @param {boolean} [withQuorum]
 *
 * @returns {function(array): Promise<array>}
 */

// Recheck This Sachu, Should Adapt with finality updates
const getLatestInclusion = (settings, withQuorum = false) => (hashes) =>
    withQuorum
        ? quorum.getLatestInclusion(hashes).catch((err) => {
              throw new Error(err);
          })
        : getHelixInstance(settings, getApiTimeout('getInclusionStates'))
              .getInclusionStates(hashes, [])
              .catch((err) => {
                  throw new Error(err);
              });

/**
 * Helix promoteTransaction with an option to perform PoW locally
 *
 * @method promoteTransaction
 * @param {object} [settings]
 * @param {object} seedStore
 *
 * @returns {function(string, number, number, object): Promise<string>}
 */
const promoteTransaction = (settings, seedStore) => (
    hash,
    depth = DEFAULT_DEPTH,
    minWeightMagnitude = DEFAULT_MIN_WEIGHT_MAGNITUDE,
    transfer = { address: '0'.repeat(64), value: 0, message: '', tag: '' },
) => {
    const cached = {
        txs: [],
    };
    return isPromotable(settings)(hash)
        .then(() => prepareTransfers(settings)(transfer.address, [transfer]))
        .then((txs) => {
            cached.txs = txs;

            return getTransactionsToApprove(settings)(hash, depth);
        })
        .then(({ trunkTransaction, branchTransaction }) =>
            attachToTangle(settings, seedStore)(trunkTransaction, branchTransaction, cached.txs, minWeightMagnitude),
        )
        .then(({ txs }) => {
            cached.txs = txs;
            return storeAndBroadcast(settings)(cached.txs);
        })
        .then((hash) => hash)
        .catch((err) => {
            throw new Error(err);
        });
};

/**
 * Helix ReplayBundle
 *
 * @method replayBundle
 * @param {object} [settings]
 * @param {object} seedStore
 *
 * @returns {function(string, function, number, number): Promise<array>}
 */
const replayBundle = (settings, seedStore) => (
    hash,
    depth = DEFAULT_DEPTH,
    minWeightMagnitude = DEFAULT_MIN_WEIGHT_MAGNITUDE,
) => {
    const cached = {
        txs: [],
        transactionObjects: [],
    };

    return getBundle(settings)(hash)
        .then((bundle) => {
            const convertToTxBytes = (tx) => asTransactionStrings(tx);
            cached.txs = map(bundle, convertToTxBytes);
            cached.transactionObjects = bundle;

            return getTransactionsToApprove(settings)({}, depth);
        })
        .then(({ trunkTransaction, branchTransaction }) =>
            attachToTangle(settings, seedStore)(trunkTransaction, branchTransaction, cached.txs, minWeightMagnitude),
        )
        .then(({ txs, transactionObjects }) => {
            cached.txs = txs;
            cached.transactionObjects = transactionObjects;

            return storeAndBroadcast(settings)(cached.txs);
        })
        .then(() => cached.transactionObjects)
        .catch((err) => {
            throw new Error(err);
        });
};

/**
 * Helix getBundle
 *
 * @method getBundle
 * @param {object} [settings]
 *
 * @returns {function(string): Promise<array>}
 */
const getBundle = (settings) => (tailTransactionHash) =>
    getHelixInstance(settings)
        .getBundle(tailTransactionHash)
        .catch((err) => {
            throw new Error(err);
        });

/**
 * Helix wereAddressesSpentFrom
 *
 * @method wereAddressesSpentFrom
 * @param {object} [settings]
 * @param {boolean} [withQuorum]
 *
 * @returns {function(array): Promise<array>}
 */
const wereAddressesSpentFrom = (settings, withQuorum = true) => (addresses) =>
    withQuorum
        ? quorum.wereAddressesSpentFrom(addresses).catch((err) => {
              throw new Error(err);
          })
        : getHelixInstance(settings, getApiTimeout('wereAddressesSpentFrom'))
              .wereAddressesSpentFrom(addresses)
              .catch((err) => {
                  throw new Error(err);
              });

/**
 * Helix sendTransfer
 *
 * @method sendTransfer
 * @param {object} [settings]
 *
 * @returns {function(object, array, function, *, number, number): Promise<array>}
 */
const sendTransfer = (settings) => (
    seedStore,
    transfers,
    options = null,
    depth = DEFAULT_DEPTH,
    minWeightMagnitude = DEFAULT_MIN_WEIGHT_MAGNITUDE,
) => {
    const cached = {
        txs: [],
        transactionObjects: [],
    };
    return seedStore
        .prepareTransfers(settings)(transfers, options)
        .then((txs) => {
            cached.txs = txs;
            return getTransactionsToApprove(settings)({}, depth);
        })
        .then(({ trunkTransaction, branchTransaction }) =>
            attachToTangle(settings, seedStore)(trunkTransaction, branchTransaction, cached.txs, minWeightMagnitude),
        )
        .then(({ txs, transactionObjects }) => {
            cached.txs = txs;
            cached.transactionObjects = transactionObjects;
            return storeAndBroadcast(settings)(cached.txs);
        })
        .then(() => cached.transactionObjects)
        .catch((err) => {
            throw new Error(err);
        });
};

/**
 * Helix getTransactionsToApprove
 *
 * @method getTransactionsToApprove
 * @param {object} [settings]
 *
 * @returns {function(*, number): Promise<object>}
 */
const getTransactionsToApprove = (settings) => (reference = {}, depth = DEFAULT_DEPTH) => {
    if (isEmpty(reference)) {
        return getHelixInstance(settings, getApiTimeout('getTransactionsToApprove'))
            .getTransactionsToApprove(depth)
            .catch((err) => {
                throw new Error(err);
            });
    }
    return getHelixInstance(settings, getApiTimeout('getTransactionsToApprove'))
        .getTransactionsToApprove(depth, reference)
        .catch((err) => {
            throw new Error(err);
        });
};

/**
 * Helix prepareTransfers
 *
 * @method prepareTransfers
 * @param {object} [settings]
 *
 * @returns {function(string, array, *): Promise<any>}
 */
export const prepareTransfers = (settings) => (seed, transfers, options = null, signatureFn = null) => {
    let args = [seed, transfers];
    if (options) {
        args = [...args, { ...options, nativeGenerateSignatureFunction: signatureFn }];
    }

    return getHelixInstance(settings)
        .prepareTransfers(...args)
        .catch((err) => {
            throw new Error(err);
        });
};

/**
 * Helix storeAndBroadcast
 *
 * @method storeAndBroadcast
 * @param {object} [settings]
 *
 * @returns {function(array): Promise<any>}
 */
const storeAndBroadcast = (settings) => (txs) =>
    getHelixInstance(settings)
        .storeAndBroadcast(txs)
        .catch((err) => {
            throw new Error(err);
        });

/**
 * Checks if attachToTangle is available on the provided node
 *
 * @method checkAttachToTangle
 * @param {string} node
 *
 * @returns {Promise}
 */
const checkAttachToTangle = (node) => {
    return fetch(node, {
        method: 'POST',
        body: JSON.stringify({ command: 'attachToTangle' }),
        headers: new Headers({
            'Content-Type': 'application/json',
            'X-HELIX-API-Version': IRI_API_VERSION,
        }),
    })
        .then((response) => {
            if (response.ok) {
                return response.json();
            }

            throw response;
        })
        .catch(() => {
            // return a fake normal IRI response when attachToTangle is not available
            return { error: Errors.ATTACH_TO_TANGLE_UNAVAILABLE };
        });
};

/**
 * Checks if remote pow is allowed on the provided node
 *
 * @method allowsRemotePow
 * @param {object} settings
 *
 * @returns {Promise<Boolean>}
 */
const allowsRemotePow = (settings) => {
    return getNodeInfo(settings)()
        .then((info) => {
            // Check if provided node has upgraded to IRI to a version, where it adds "features" prop in node info
            if (has(info, 'features')) {
                return includes(info.features, 'RemotePOW');
            }
            // Fallback to old way of checking remote pow
            return checkAttachToTangle(settings.url).then((response) =>
                includes(response.error, Errors.INVALID_PARAMETERS),
            );
        })
        .catch((err) => {
            throw new Error(err);
        });
};

/**
 * Helix attachToTangle
 *
 * @method attachToTangle
 * @param {object} [settings]
 * @param {object} seedStore
 *
 * @returns {function(string, string, array, number): Promise<object>}
 */
const attachToTangle = (settings, seedStore) => (
    trunkTransaction,
    branchTransaction,
    txs,
    minWeightMagnitude = DEFAULT_MIN_WEIGHT_MAGNITUDE,
) => {
    const shouldOffloadPow = get(seedStore, 'offloadPow') === true;
    if (shouldOffloadPow) {
        const request = (requestTimeout) =>
            new Promise((resolve, reject) => {
                return getHelixInstance(settings, requestTimeout)
                    .attachToTangle(
                        trunkTransaction,
                        branchTransaction,
                        minWeightMagnitude,
                        // Make sure txs are sorted properly
                        sortTransactionTxBytesArray(txs),
                    )
                    .then((attachedBytes, err) => {
                        if (err) {
                            reject(err);
                        } else {
                            constructBundleFromAttachedTxBytes(attachedBytes, seedStore).then((transactionObjects) => {
                                if (
                                    isBundle(transactionObjects) &&
                                    isBundleTraversable(transactionObjects, trunkTransaction, branchTransaction)
                                ) {
                                    resolve({
                                        transactionObjects,
                                        txs: attachedBytes,
                                    });
                                } else {
                                    reject(new Error(Errors.INVALID_BUNDLE_CONSTRUCTED_WITH_REMOTE_POW));
                                }
                            });
                        }
                    });
            }).catch((err) => {
                throw new Error(err);
            });

        const defaultRequestTimeout = getApiTimeout('attachToTangle');

        return withRequestTimeoutsHandler(defaultRequestTimeout)(request).catch((err) => err);
    }
    return seedStore
        .performPow(txs, trunkTransaction, branchTransaction, minWeightMagnitude)
        .then((result) => {
            if (get(result, 'txs') && get(result, 'transactionObjects')) {
                return Promise.resolve(result);
            }
            // Batched proof-of-work only returns the attached txs
            return constructBundleFromAttachedTxBytes(sortTransactionTxBytesArray(result), seedStore).then(
                (transactionObjects) => ({
                    transactionObjects: orderBy(transactionObjects, 'currentIndex', ['desc']),
                    txs: result,
                }),
            );
        })
        .then(({ transactionObjects, txs }) => {
            if (
                isBundle(transactionObjects) &&
                isBundleTraversable(transactionObjects, trunkTransaction, branchTransaction)
            ) {
                return {
                    transactionObjects,
                    txs,
                };
            }

            throw new Error(Errors.INVALID_BUNDLE_CONSTRUCTED_WITH_LOCAL_POW);
        })
        .catch((err) => {
            throw new Error(err);
        });
};

/**
 * Helix getTransactionStrings
 *
 * @method getTransactionStrings
 * @param {object} [settings]
 *
 * @returns {function(array): Promise<array>}
 */
// const getTransactionStrings = (settings) => (hashes) =>
//   getHelixInstance(settings)
//     .getTransactionStrings(hashes)
//     .catch((err) =>{ throw new Error(err);});

/**
 * Checks if a node is synced and runs a stable IRI release
 *
 * @method isNodeHealthy
 * @param {object} [settings]
 *
 * @returns {Promise}
 */

// Finality Update Sync Check
const isNodeHealthy = (settings) => {
    return getNodeInfo(settings)().then(({ appVersion, currentRoundIndex, latestSolidRoundIndex }) => {
        if (['rc', 'beta', 'alpha'].some((el) => appVersion.toLowerCase().indexOf(el) > -1)) {
            throw new Error(Errors.UNSUPPORTED_NODE);
        }
        const roundGap = currentRoundIndex - latestSolidRoundIndex;
        if (roundGap < MAX_MILESTONE_FALLBEHIND && roundGap >= 0) {
            return true;
        }
        throw new Error(Errors.NODE_NOT_SYNCED);
    });
};

/**
 * Helix isPromotable.
 *
 * @method isPromotable
 * @param {object} [settings]
 *
 * @returns {function(string): (Promise<boolean>)}
 */
const isPromotable = (settings) => (tailTransactionHash) =>
    getHelixInstance(settings)
        .isPromotable(tailTransactionHash)
        .catch((err) => {
            throw new Error(err);
        });

export {
    getHelixInstance,
    getApiTimeout,
    getBalances,
    getNodeInfo,
    getTransactionsObjects,
    findTransactionObjects,
    findTransactions,
    getLatestInclusion,
    promoteTransaction,
    replayBundle,
    getBundle,
    wereAddressesSpentFrom,
    sendTransfer,
    getTransactionsToApprove,
    storeAndBroadcast,
    attachToTangle,
    checkAttachToTangle,
    allowsRemotePow,
    isNodeHealthy,
    isPromotable,
};
