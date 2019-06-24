import React from 'react';
import { connect } from 'react-redux';
import css from './index.scss';
import classNames from 'classnames';
import { withI18n, Trans } from 'react-i18next';
import PropTypes from 'prop-types';
import images from 'ui/images/ic1.png';
import Button from 'ui/components/button';
import Top from '../../components/topbar';
import Logos from 'ui/components/logos';

class Done extends React.PureComponent {
    static propTypes = {
        history: PropTypes.object,
        t: PropTypes.func.isRequired,
    };

    /**
     * Navigate to Login view
     * @returns {undefined}
     */

    // stepForward(route) {
    // this.handleClick=this.handleClick.bind(this);

    //     this.props.history.push(`/onboarding/${route}`);
    // }

    // setComplete = () => {
    //     const { history } = this.props;
    //     history.push('/onboarding/login');
    // };

    render() {
        const { t } = this.props;
        return (
            <div>
                <Logos
                />
                <section className="spage_1">
                    <div className="container">
                        <div className="row">
                            <div className={classNames(css.sseed_box, css.cre_pgs)}>
                                <h1>{t('onboardingComplete:allDone')}<span className={classNames(css.text_color)}>!</span> </h1>
                                <h6>{t('onboardingComplete:walletReady')}</h6>
                                <div className={classNames(css.icon_secs)}>
                                    <div className={(classNames(css.img_sr, css.img_sr_imgss1))}>
                                        <img src="" alt="" />
                                    </div>
                                </div>
                            </div>
                            <div className={css.onboard_nav}>
                                <Button className="navleft" variant="backgroundNone" onClick={() => this.props.history.push('/onboarding/seed-verify')} >{t('global:goBack')} <span>></span></Button>
                                <Button className="navright" variant="backgroundNone" onClick={() => this.props.history.push('/onboarding/login')} >{t('login:login')} <span>></span></Button>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        )
    }
}

const mapDispatchToProps = {

};

export default connect(null, mapDispatchToProps)(withI18n()(Done));