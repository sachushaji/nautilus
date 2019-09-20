import React from "react";
import { connect } from "react-redux";
import css from "./wallet.scss";
import classNames from "classnames";
import Top from "../../components/topbar";
import List from "ui/components/list";
import {
  getSelectedAccountName,
  getSelectedAccountMeta
} from "selectors/accounts";
import { getAccountInfo } from "actions/accounts";
import SeedStore from "libs/seed";

import PropTypes from "prop-types";
import reload from "ui/images/refresh.svg";
import { withI18n } from "react-i18next";
import Button from "ui/components/button";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
/**
 * Wallet History component
 */
class WalletHistory extends React.PureComponent {
  static propTypes = {
    location: PropTypes.object,
    history: PropTypes.shape({
      push: PropTypes.func.isRequired
    }).isRequired,
    t: PropTypes.func.isRequired,
    getAccountInfo: PropTypes.func.isRequired,
    accountName: PropTypes.string.isRequired,
    accountMeta: PropTypes.object.isRequired,
    password: PropTypes.object.isRequired
  };
  state = {
    active: "li0"
  };
  handleActive(element) {
    this.setState({
      active: element
    });
  }

  updateAccount = async () => {
    console.log("Upadating...");
    
    const { password, accountName, accountMeta } = this.props;
console.log("AccountName==",accountName);

    const seedStore = await new SeedStore[accountMeta.type](
      password,
      accountName,
      accountMeta
    );
console.log("Seedstore===",seedStore);

    this.props.getAccountInfo(
      seedStore,
      accountName,
      Electron.notify,
      true // Sync with quorum enabled
    );

  };

  render() {
    const { t, history, location } = this.props;
    const subroute = location.pathname.split("/")[3] || null;

    return (
      <div>
        <section className={css.home}>
          {/* <Top disp={"block"} history={this.props.history} /> */}
          <div className={classNames(css.pg1_foo3)}>
            <div className="container">
              <div className="row">
                <div className="col-lg-12">
                  <div className={classNames(css.foo_bxx1)}>
                  <h3 className={css.heading}>TRANSACTION HISTORY</h3>
                {/* <div className={css.search}><input type="text" className={css.search_text} placeholder="Type text here..." /></div>
                <div className={css.search}><select className={css.sort_text} placeholder="Sort by">
                  <option value="all">All</option>
                  <option value="sent">Sent</option>
                  <option value="receive">Receive</option>
                  <option value="pending">Pending</option>
                  </select></div> */}
                  <List
                        updateAccount={() => this.updateAccount()}
                        setItem={item =>
                          item !== null
                            ? history.push(`/wallet/history/${item}`)
                            : history.push("/wallet/history")
                        }
                        currentItem={subroute}
                        style= {{ height: "20vw" }}
                      />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
       
      </div>
    );
  }
}

const mapStateToProps = state => ({
  accountName: getSelectedAccountName(state),
  accountMeta: getSelectedAccountMeta(state),
  password: state.wallet.password
});

const mapDispatchToProps = {
  getAccountInfo
};
export default connect(
  mapStateToProps,
  mapDispatchToProps
)(withI18n()(WalletHistory));
