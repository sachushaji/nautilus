import i18next from "../libs/i18next";
import { Wallet } from "../database";
import { getSelectedNodeFromState } from "../selectors/global";
import { changeHelixNode } from "../libs/hlx";
import { SettingsActionTypes } from "../actions/types";
import {
  generateAlert,
  generateNodeOutOfSyncErrorAlert,
  generateUnsupportedNodeErrorAlert
} from "../actions/alerts";
import { allowsRemotePow } from "../libs/hlx/extendedApi";
import get from "lodash/get";
import keys from "lodash/keys";
/**
 * Change wallet's active language
 *
 * @method setLocale
 * @param {string} locale
 *
 * @returns {function} dispatch
 */
export function setLocale(locale) {
  return dispatch => {
    i18next.changeLanguage(locale);
    Wallet.updateLocale(locale);
    return dispatch({
      type: SettingsActionTypes.SET_LOCALE,
      payload: locale
    });
  };
}

/**
 * Change wallet's active theme
 *
 * @method updateTheme
 *
 * @param {string} payload
 *
 * @returns {function} dispatch
 */
export function updateTheme(payload) {
  return dispatch => {
    dispatch({
      type: SettingsActionTypes.UPDATE_THEME,
      payload
    });
  };
}

/**
 * Dispatch when user has accepted wallet's terms and conditions
 *
 * @method acceptTerms
 *
 * @returns {{type: {string} }}
 */
export const acceptTerms = () => {
  Wallet.acceptTerms();
  return {
    type: SettingsActionTypes.ACCEPT_TERMS
  };
};

/**
 * Dispatch when user has accepted wallet's privacy agreement
 *
 * @method acceptPrivacy
 *
 * @returns {{type: {string} }}
 */
export const acceptPrivacy = () => {
  Wallet.acceptPrivacyPolicy();
  return {
    type: SettingsActionTypes.ACCEPT_PRIVACY
  };
};

/**
 * Dispatch to change selected IRI node
 *
 * @method changeNode
 * @param {string} payload
 *
 * @returns {{type: {string}, payload: {string} }}
 */
export const changeNode = payload => (dispatch, getState) => {
  if (getSelectedNodeFromState(getState()) !== payload) {
    dispatch(setNode(payload));
    // Change provider on global helix instance
    changeHelixNode(payload);
  }
};

/**
 * Dispatch to change wallet's active node
 *
 * @method setNode
 * @param {object} payload
 *
 * @returns {{type: {string}, payload: {string} }}
 */
export const setNode = (payload) => {
  Wallet.updateNode(payload.url);

  return {
      type: SettingsActionTypes.SET_NODE,
      payload,
  };
};


/**
 * Makes an API call for checking if attachToTangle is enabled on the selected IRI node
 * and changes proof of work configuration for wallet
 *
 * @method changePowSettings
 *
 * @returns {function}
 */
export function changePowSettings() {
  return (dispatch, getState) => {
    const settings = getState().settings;
    if (!settings.remotePoW) {
      allowsRemotePow(settings.node).then(hasRemotePow => {
        if (!hasRemotePow) {
          return dispatch(
            generateAlert(
              "error",
              i18next.t("global:attachToTangleUnavailable"),
              i18next.t("global:attachToTangleUnavailableExplanationShort"),
              10000
            )
          );
        }
        dispatch(setRemotePoW(!settings.remotePoW));
        dispatch(
          generateAlert(
            "success",
            i18next.t("pow:powUpdated"),
            i18next.t("pow:powUpdatedExplanation")
          )
        );
      });
    } else {
      dispatch(setRemotePoW(!settings.remotePoW));
      dispatch(
        generateAlert(
          "success",
          i18next.t("pow:powUpdated"),
          i18next.t("pow:powUpdatedExplanation")
        )
      );
    }
  };
}
/**
 * Dispatch to update proof of work configuration for wallet
 *
 * @method setRemotePoW
 * @param {boolean} payload
 *
 * @returns {{type: {string}, payload: {boolean} }}
 */
export const setRemotePoW = payload => {
  Wallet.updateRemotePowSetting(payload);
  return {
    type: SettingsActionTypes.SET_REMOTE_POW,
    payload
  };
};

/**
 * Dispatch to set a randomly selected node as the active node for wallet
 *
 * @method setRandomlySelectedNode
 * @param {string} payload
 *
 * @returns {{type: {string}, payload: {string} }}
 */
export const setRandomlySelectedNode = payload => {
  Wallet.setRandomlySelectedNode(payload);

  return {
    type: SettingsActionTypes.SET_RANDOMLY_SELECTED_NODE,
    payload
  };
};

/**
 * Dispatch to set updated list of IRI nodes for wallet
 *
 * @method setNodeList
 * @param {array} payload
 *
 * @returns {{type: {string}, payload: {array} }}
 */
export const setNodeList = payload => {
  Node.addNodes(payload);

  return {
    type: SettingsActionTypes.SET_NODELIST,
    payload
  };
};

/**
 * Dispatch to update auto promotion configuration for wallet
 *
 * @method setAutoPromotion
 * @param {boolean} payload
 *
 * @returns {{type: {string}, payload: {boolean} }}
 */
export const setAutoPromotion = payload => {
  Wallet.updateAutoPromotionSetting(payload);

  return {
    type: SettingsActionTypes.SET_AUTO_PROMOTION,
    payload
  };
};

/**
 * Dispatch when a network call for fetching currency information (conversion rates) is about to be made
 *
 * @method currencyDataFetchRequest
 *
 * @returns {{type: {string} }}
 */
const currencyDataFetchRequest = () => ({
  type: SettingsActionTypes.CURRENCY_DATA_FETCH_REQUEST
});

/**
 * Dispatch when there is an error fetching currency information
 *
 * @method currencyDataFetchError
 *
 * @returns {{type: {string} }}
 */
const currencyDataFetchError = () => ({
  type: SettingsActionTypes.CURRENCY_DATA_FETCH_ERROR
});

/**
 * Dispatch when currency information (conversion rates) is about to be fetched
 *
 * @method currencyDataFetchSuccess
 * @param {object} payload
 *
 * @returns {{type: {string}, payload: {object} }}
 */
export const currencyDataFetchSuccess = payload => {
  Wallet.updateCurrencyData(payload);

  return {
    type: SettingsActionTypes.CURRENCY_DATA_FETCH_SUCCESS,
    payload
  };
};

/**
 * Makes an API call for checking if attachToTangle is enabled on the selected IRI node
 * and changes auto promotion configuration for wallet
 *
 * @method changeAutoPromotionSettings
 *
 * @returns {function}
 */
export function changeAutoPromotionSettings() {
  return (dispatch, getState) => {
      const settings = getState().settings;
      if (!settings.autoPromotion) {
          allowsRemotePow(settings.node).then((hasRemotePow) => {
              if (!hasRemotePow) {
                  return dispatch(
                      generateAlert(
                          'error',
                          i18next.t('global:attachToTangleUnavailable'),
                          i18next.t('global:attachToTangleUnavailableExplanationShort'),
                          10000,
                      ),
                  );
              }
              dispatch(setAutoPromotion(!settings.autoPromotion));
              dispatch(
                  generateAlert(
                      'success',
                      i18next.t('autoPromotion:autoPromotionUpdated'),
                      i18next.t('autoPromotion:autoPromotionUpdatedExplanation'),
                  ),
              );
          });
      } else {
          dispatch(setAutoPromotion(!settings.autoPromotion));
          dispatch(
              generateAlert(
                  'success',
                  i18next.t('autoPromotion:autoPromotionUpdated'),
                  i18next.t('autoPromotion:autoPromotionUpdatedExplanation'),
              ),
          );
      }
  };
}
/**
 * Fetch currency information (conversion rates) for wallet
 *
 * @method getCurrencyData
 *
 * @param {string} currency
 * @param {boolean} withAlerts
 *
 * @returns {function(*): Promise<any>}
 */
export function getCurrencyData(currency, withAlerts = false) {
  const url =
    "https://trinity-exchange-rates.herokuapp.com/api/latest?base=USD";
  return dispatch => {
    dispatch(currencyDataFetchRequest());

    return fetch(url)
      .then(
        response => response.json(),
        () => {
          dispatch(currencyDataFetchError());

          if (withAlerts) {
            dispatch(
              generateAlert(
                "error",
                i18next.t("settings:couldNotFetchRates"),
                i18next.t("settings:couldNotFetchRatesExplanation", {
                  currency: currency
                })
              )
            );
          }
        }
      )
      .then(json => {
        const conversionRate = get(json, `rates.${currency}`) || 1;
        const availableCurrencies = keys(get(json, "rates"));

        const payload = { conversionRate, currency, availableCurrencies };

        // Update redux
        dispatch(currencyDataFetchSuccess(payload));

        if (withAlerts) {
          dispatch(
            generateAlert(
              "success",
              i18next.t("settings:fetchedConversionRates"),
              i18next.t("settings:fetchedConversionRatesExplanation", {
                currency: currency
              })
            )
          );
        }
      });
  };
}

/**
 * Dispatch to show/hide empty transactions in transactions history
 *
 * @method toggleEmptyTransactions
 *
 * @returns {{type: {string} }}
 */
export const toggleEmptyTransactions = () => {
  Wallet.toggleEmptyTransactionsDisplay();

  return {
    type: SettingsActionTypes.TOGGLE_EMPTY_TRANSACTIONS
  };
};
