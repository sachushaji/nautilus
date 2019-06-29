import get from 'lodash/get';
import head from 'lodash/head';
import has from 'lodash/has';
import includes from 'lodash/includes';
import map from 'lodash/map';
import orderBy from 'lodash/orderBy';
import { composeAPI } from '@helixnetwork/core';
import { helix, quorum } from './index';
import Errors from '../errors';
import { isWithinMinutes } from '../date';
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
    sortTransactionBytesArray,
    constructBundleFromAttachedBytes,
    isBundle,
    isBundleTraversable,
} from './transfers';
import { EMPTY_HASH_BYTES, withRequestTimeoutsHandler } from './utils';

/**
 * Returns timeouts for specific quorum requests
 *
 * @method getApiTimeout
 * @param {string} method
 * @param {array} [payload]

 * @returns {number}
 */
/* eslint-disable no-unused-vars */
const getApiTimeout = (method) => {
    /* eslint-enable no-unused-vars */
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
        // TODO
        const { url, token, password } = settings;

        const instance = composeAPI({
            provider: URL
        })

        // TODO
        // instance.api.setApiTimeout(requestTimeout);

        return instance;
    }

    // iota.api.setApiTimeout(requestTimeout);

    return helix;
};

/**
 * Helix getBalances
 *
 * @method getBalancesAsync
 * @param {object} [settings]
 * @param {boolean} [withQuorum]
 *
 * @returns {function(array, number): Promise<object>}
 */
const getBalancesAsync = (settings, withQuorum = true) => (addresses, threshold = DEFAULT_BALANCES_THRESHOLD) =>
    withQuorum
        ? quorum.getBalances(addresses, threshold)
        : getHelixInstance(settings, getApiTimeout('getBalances')).getBalances(addresses, threshold);

/**
 * helix getNodeInfoApi
 *
 * @method getNodeInfoAsync
 * @param {object} [settings]
 *
 * @returns {function(): Promise<object>}
 */
const getNodeInfoAsync = (settings) => () =>
        getHelixInstance(settings, getApiTimeout('getNodeInfo')).getNodeInfo();


/**
 * Helix getTransactionsObjects
 *
 * @method getTransactionsObjectsAsync
 * @param {object} [settings]
 *
 * @returns {function(array): Promise<any>}
 */
const getTransactionsObjectsAsync = (settings) => (hashes) =>
        getHelixInstance(settings).getTransactionsObjects(hashes);
   
// TODO : Check if fintransaction objects to be used the new dedicated helix method
/**
 * Helix findTransactionObjects
 *
 * @method findTransactionObjectsAsync
 * @param {object} [settings]
 *
 * @returns {function(object): Promise<any>}
 */
const findTransactionObjectsAsync = (settings) => (args) =>
    findTransactionsAsync(settings)(args).then((hashes) => getTransactionsObjectsAsync(settings)(hashes));

/**
 * Helix findTransactions
 *
 * @method findTransactionsAsync
 * @param {object} [settings]
 *
 * @returns {function(object): Promise<array>}
 */
const findTransactionsAsync = (settings) => (args) =>
        getHelixInstance(settings).findTransactions(args);


/**
 * Helix getLatestInclusion
 *
 * @method getLatestInclusionAsync
 * @param {object} [settings]
 * @param {boolean} [withQuorum]
 *
 * @returns {function(array): Promise<array>}
 */
const getLatestInclusionAsync = (settings, withQuorum = false) => (hashes) =>
    withQuorum
        ? quorum.getLatestInclusion(hashes)
        : getHelixInstance(settings, getApiTimeout('getInclusionStates')).getLatestInclusion(hashes);


/**
 * Helix promoteTransaction with an option to perform PoW locally
 *
 * @method promoteTransactionAsync
 * @param {object} [settings]
 * @param {object} seedStore
 *
 * @returns {function(string, number, number, object): Promise<string>}
 */
const promoteTransactionAsync = (settings, seedStore) => (
    hash,
    depth = DEFAULT_DEPTH,
    minWeightMagnitude = DEFAULT_MIN_WEIGHT_MAGNITUDE,
    transfer = { address: '0'.repeat(64), value: 0, message: '', tag: '' },
) => {
    const cached = {
        bytes: [],
    };

    return (
        isPromotable(settings)(hash)
            .then(() => prepareTransfersAsync(settings)(transfer.address, [transfer]))
            .then((bytes) => {
                cached.bytes = bytes;

                return getTransactionsToApproveAsync(settings)(
                    {
                        reference: hash,
                        adjustDepth: true,
                    },
                    depth,
                );
            })
            .then(({ trunkTransaction, branchTransaction }) =>
                attachToTangleAsync(settings, seedStore)(
                    trunkTransaction,
                    branchTransaction,
                    cached.bytes,
                    minWeightMagnitude,
                ),
            )
            .then(({ bytes }) => {
                cached.bytes = bytes;

                return storeAndBroadcastAsync(settings)(cached.bytes);
            })
            .then(() => hash)
    );
};

/**
 * Helix ReplayBundle
 *
 * @method replayBundleAsync
 * @param {object} [settings]
 * @param {object} seedStore
 *
 * @returns {function(string, function, number, number): Promise<array>}
 */
const replayBundleAsync = (settings, seedStore) => (
    hash,
    depth = DEFAULT_DEPTH,
    minWeightMagnitude = DEFAULT_MIN_WEIGHT_MAGNITUDE,
) => {
    const cached = {
        bytes: [],
        transactionObjects: [],
    };

    return getBundleAsync(settings)(hash)
        .then((bundle) => {
            const convertToBytes = (tx) => iota.utils.transactionBytes(tx);
            cached.bytes = map(bundle, convertToBytes);
            cached.transactionObjects = bundle;

            return getTransactionsToApproveAsync(settings)({}, depth);
        })
        .then(({ trunkTransaction, branchTransaction }) =>
            attachToTangleAsync(settings, seedStore)(
                trunkTransaction,
                branchTransaction,
                cached.bytes,
                minWeightMagnitude,
            ),
        )
        .then(({ bytes, transactionObjects }) => {
            cached.bytes = bytes;
            cached.transactionObjects = transactionObjects;

            return storeAndBroadcastAsync(settings)(cached.bytes);
        })
        .then(() => cached.transactionObjects);
};

/**
 * Promisified version of iota.api.getBundle
 *
 * @method getBundleAsync
 * @param {object} [settings]
 *
 * @returns {function(string): Promise<array>}
 */
const getBundleAsync = (settings) => (tailTransactionHash) =>
    new Promise((resolve, reject) => {
        getHelixInstance(settings).api.getBundle(tailTransactionHash, (err, bundle) => {
            if (err) {
                reject(err);
            } else {
                resolve(bundle);
            }
        });
    });

/**
 * Promisified version of iota.api.wereAddressesSpentFrom
 *
 * @method wereAddressesSpentFromAsync
 * @param {object} [settings]
 * @param {boolean} [withQuorum]
 *
 * @returns {function(array): Promise<array>}
 */
const wereAddressesSpentFromAsync = (settings, withQuorum = true) => (addresses) =>
    withQuorum
        ? quorum.wereAddressesSpentFrom(addresses)
        : new Promise((resolve, reject) => {
              getHelixInstance(settings, getApiTimeout('wereAddressesSpentFrom')).api.wereAddressesSpentFrom(
                  addresses,
                  (err, wereSpent) => {
                      if (err) {
                          reject(err);
                      } else {
                          resolve(wereSpent);
                      }
                  },
              );
          });

/**
 * Promisified version of iota.api.sendTransfer
 *
 * @method sendTransferAsync
 * @param {object} [settings]
 *
 * @returns {function(object, array, function, *, number, number): Promise<array>}
 */
const sendTransferAsync = (settings) => (
    seedStore,
    transfers,
    options = null,
    depth = DEFAULT_DEPTH,
    minWeightMagnitude = DEFAULT_MIN_WEIGHT_MAGNITUDE,
) => {
    const cached = {
        bytes: [],
        transactionObjects: [],
    };

    return seedStore
        .prepareTransfers(settings)(transfers, options)
        .then((bytes) => {
            cached.bytes = bytes;

            return getTransactionsToApproveAsync(settings)({}, depth);
        })
        .then(({ trunkTransaction, branchTransaction }) =>
            attachToTangleAsync(settings, seedStore)(
                trunkTransaction,
                branchTransaction,
                cached.bytes,
                minWeightMagnitude,
            ),
        )
        .then(({ bytes, transactionObjects }) => {
            cached.bytes = bytes;
            cached.transactionObjects = transactionObjects;

            return storeAndBroadcastAsync(settings)(cached.bytes);
        })
        .then(() => cached.transactionObjects);
};

/**
 * Helix getTransactionsToApprove
 *
 * @method getTransactionsToApproveAsync
 * @param {object} [settings]
 *
 * @returns {function(*, number): Promise<object>}
 */
const getTransactionsToApproveAsync = (settings) => (reference = {}, depth = DEFAULT_DEPTH) =>
        getHelixInstance(settings, getApiTimeout('getTransactionsToApprove')).getTransactionsToApprove(
            depth,
            reference);

/**
 * Helix prepareTransfers
 *
 * @method prepareTransfersAsync
 * @param {object} [settings]
 *
 * @returns {function(string, array, *): Promise<any>}
 */
export const prepareTransfersAsync = (settings) => (seed, transfers, options = null, signatureFn = null) => {
    // https://github.com/iotaledger/iota.lib.js/blob/e60c728c836cb37f3d6fb8b0eff522d08b745caa/lib/api/api.js#L1058
    let args = [seed, transfers];

    if (options) {
        args = [...args, { ...options, nativeGenerateSignatureFunction: signatureFn }];
    }

   return getHelixInstance(settings).prepareTransfers(...args);
};

/**
 * Helix storeAndBroadcast
 *
 * @method storeAndBroadcastAsync
 * @param {object} [settings]
 *
 * @returns {function(array): Promise<any>}
 */
const storeAndBroadcastAsync = (settings) => (bytes) =>
        getHelixInstance(settings).storeAndBroadcast(bytes);


/**
 * Checks if attachToTangle is available on the provided node
 *
 * @method checkAttachToTangleAsync
 * @param {string} node
 *
 * @returns {Promise}
 */
const checkAttachToTangleAsync = (node) => {
    return fetch(node, {
        method: 'POST',
        body: JSON.stringify({ command: 'attachToTangle' }),
        headers: new Headers({
            'Content-Type': 'application/json',
            'X-HELIX-API-Version': IRI_API_VERSION,
        }),
    })
        .then((res) => res.json())
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
    return getNodeInfoAsync(settings)().then((info) => {
        // Check if provided node has upgraded to IRI to a version, where it adds "features" prop in node info
        if (has(info, 'features')) {
            return includes(info.features, 'RemotePOW');
        }

        // Fallback to old way of checking remote pow
        return checkAttachToTangleAsync(settings.url).then((response) =>
            includes(response.error, Errors.INVALID_PARAMETERS),
        );
    });
};

/**
 * Helix attachToTangle
 *
 * @method attachToTangleAsync
 * @param {object} [settings]
 * @param {object} seedStore
 *
 * @returns {function(string, string, array, number): Promise<object>}
 */
const attachToTangleAsync = (settings, seedStore) => (
    trunkTransaction,
    branchTransaction,
    bytes,
    minWeightMagnitude = DEFAULT_MIN_WEIGHT_MAGNITUDE,
) => {
    const shouldOffloadPow = get(seedStore, 'offloadPow') === true;

    if (shouldOffloadPow) {
        const request = (requestTimeout) =>
                getHelixInstance(settings, requestTimeout).attachToTangle(
                    trunkTransaction,
                    branchTransaction,
                    minWeightMagnitude,
                    // Make sure bytes are sorted properly
                    sortTransactionBytesArray(bytes)).then(
                    (err, attachedBytes) => {
                        if (err) {
                            reject(err);
                        } else {
                            constructBundleFromAttachedBytes(attachedBytes, seedStore)
                                .then((transactionObjects) => {
                                    if (
                                        isBundle(transactionObjects) &&
                                        isBundleTraversable(transactionObjects, trunkTransaction, branchTransaction)
                                    ) {
                                        resolve({
                                            transactionObjects,
                                            bytes: attachedBytes,
                                        });
                                    } else {
                                        reject(new Error(Errors.INVALID_BUNDLE_CONSTRUCTED_WITH_REMOTE_POW));
                                    }
                                })
                                .catch(reject);
                        }
                    });
                

        const defaultRequestTimeout = getApiTimeout('attachToTangle');

        return withRequestTimeoutsHandler(defaultRequestTimeout)(request);
    }

    return seedStore
        .performPow(bytes, trunkTransaction, branchTransaction, minWeightMagnitude)
        .then((result) => {
            if (get(result, 'bytes') && get(result, 'transactionObjects')) {
                return Promise.resolve(result);
            }

            // Batched proof-of-work only returns the attached bytes
            return constructBundleFromAttachedBytes(sortTransactionBytesArray(result), seedStore).then(
                (transactionObjects) => ({
                    transactionObjects: orderBy(transactionObjects, 'currentIndex', ['desc']),
                    bytes: result,
                }),
            );
        })
        .then(({ transactionObjects, bytes }) => {
            if (
                isBundle(transactionObjects) &&
                isBundleTraversable(transactionObjects, trunkTransaction, branchTransaction)
            ) {
                return {
                    transactionObjects,
                    bytes,
                };
            }

            throw new Error(Errors.INVALID_BUNDLE_CONSTRUCTED_WITH_LOCAL_POW);
        });
};

/**
 * Helix getBytes
 *
 * @method getBytesAsync
 * @param {object} [settings]
 *
 * @returns {function(array): Promise<array>}
 */
const getBytesAsync = (settings) => (hashes) =>
        getHelixInstance(settings).getBytes(hashes);

/**
 * Checks if a node is synced and runs a stable IRI release
 *
 * @method isNodeHealthy
 * @param {object} [settings]
 *
 * @returns {Promise}
 */
const isNodeHealthy = (settings) => {
    const cached = {
        latestMilestone: EMPTY_HASH_BYTES,
    };

    return getNodeInfoAsync(settings)()
        .then(
            ({
                appVersion,
                latestMilestone,
                latestMilestoneIndex,
                latestSolidSubtangleMilestone,
                latestSolidSubtangleMilestoneIndex,
            }) => {
                if (['rc', 'beta', 'alpha'].some((el) => appVersion.toLowerCase().indexOf(el) > -1)) {
                    throw new Error(Errors.UNSUPPORTED_NODE);
                }
                cached.latestMilestone = latestMilestone;
                if (
                    (cached.latestMilestone === latestSolidSubtangleMilestone ||
                        latestMilestoneIndex - MAX_MILESTONE_FALLBEHIND <= latestSolidSubtangleMilestoneIndex) &&
                    cached.latestMilestone !== EMPTY_HASH_BYTES
                ) {
                    return getBytesAsync(settings)([cached.latestMilestone]);
                }

                throw new Error(Errors.NODE_NOT_SYNCED);
            },
        )
        .then((bytes) => {
            const { timestamp } = iota.utils.transactionObject(head(bytes), cached.latestMilestone);

            return isWithinMinutes(timestamp * 1000, 5 * MAX_MILESTONE_FALLBEHIND);
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
    getHelixInstance(settings).isPromotable(tailTransactionHash);

export {
    getHelixInstance,
    getApiTimeout,
    getBalancesAsync,
    getNodeInfoAsync,
    getTransactionsObjectsAsync,
    findTransactionObjectsAsync,
    findTransactionsAsync,
    getLatestInclusionAsync,
    promoteTransactionAsync,
    replayBundleAsync,
    getBundleAsync,
    wereAddressesSpentFromAsync,
    sendTransferAsync,
    getTransactionsToApproveAsync,
    storeAndBroadcastAsync,
    attachToTangleAsync,
    checkAttachToTangleAsync,
    allowsRemotePow,
    isNodeHealthy,
    isPromotable,
};
