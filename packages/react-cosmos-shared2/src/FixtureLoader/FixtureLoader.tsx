import { isEqual } from 'lodash';
import React, { Component } from 'react';
import { FixtureState, SetFixtureState } from '../fixtureState';
import {
  getFixtureListFromWrappers,
  ReactDecorator,
  ReactDecorators,
  ReactFixtureWrappers,
} from '../react';
import {
  FixtureId,
  RendererConnect,
  RendererRequest,
  RendererResponse,
  SelectFixtureRequest,
  SetFixtureStateRequest,
} from '../renderer';
import { getFixture } from './fixtureHelpers';
import { FixtureProvider } from './FixtureProvider';

// TODO: Split into FixtureLoader and FixtureLoaderConnect
export type Props = {
  rendererId: string;
  rendererConnect: RendererConnect;
  fixtures: ReactFixtureWrappers;
  initialFixtureId?: FixtureId;
  selectedFixtureId?: null | FixtureId;
  systemDecorators: ReactDecorator[];
  userDecorators: ReactDecorators;
  renderMessage?: (args: { msg: string }) => React.ReactNode;
  onErrorReset?: () => unknown;
};

type SelectedFixture = {
  fixtureId: FixtureId;
  fixtureState: FixtureState;
  // Why is this copy of the fixtureState needed? Two reasons:
  // - To avoid posting fixtureStateChange messages with no changes from
  //   the last message
  // - To piggy back on React's setState batching and only send a
  //   fixtureStateChange message when FixtureLoader updates (via cDU),
  //   instead of posting messages in rapid succession as fixture state
  //   changes are dispatched by fixture plugins
  syncedFixtureState: FixtureState;
};

type State = {
  selectedFixture: null | SelectedFixture;
  // Used to reset FixtureProvider instance on fixturePath change
  renderKey: number;
};

function getSelectedFixtureState(fixtureId?: FixtureId | null) {
  if (!fixtureId) return null;
  return {
    fixtureId: fixtureId,
    fixtureState: {},
    syncedFixtureState: {},
  };
}

export class FixtureLoader extends Component<Props, State> {
  state: State = {
    selectedFixture: getSelectedFixtureState(
      this.props.selectedFixtureId || this.props.initialFixtureId
    ),
    renderKey: 0,
  };

  unsubscribe: null | (() => unknown) = null;

  componentDidMount() {
    if (!this.props.selectedFixtureId) {
      const { rendererConnect } = this.props;
      this.unsubscribe = rendererConnect.onMessage(this.handleRequest);
      this.postReadyState();
    }
  }

  componentWillUnmount() {
    if (this.unsubscribe) this.unsubscribe();
  }

  componentDidUpdate(prevProps: Props) {
    const { fixtures } = this.props;
    if (!isEqual(fixtures, prevProps.fixtures)) {
      this.postFixtureListUpdate();
    }

    const { selectedFixture } = this.state;
    if (selectedFixture) {
      const { fixtureId, fixtureState, syncedFixtureState } = selectedFixture;
      if (fixtureId && !isEqual(fixtureState, syncedFixtureState)) {
        this.postFixtureStateChange(fixtureId, fixtureState);
        this.updateSyncedFixtureState(fixtureState);
      }
    }
  }

  shouldComponentUpdate(prevProps: Props, prevState: State) {
    // This check exists mainly to prevent updating the fixture tree when
    // fixture state setters resulted in no fixture state change
    return !isEqual(this.props, prevProps) || !isEqual(this.state, prevState);
  }

  render() {
    const { selectedFixture } = this.state;
    if (!selectedFixture) {
      return this.renderMessage('No fixture selected.');
    }

    const { fixtures } = this.props;
    const { fixtureId, fixtureState } = selectedFixture;

    // Falsy check doesn't do because fixtures can be any Node, including
    // null or undefined.
    if (!fixtures.hasOwnProperty(fixtureId.path)) {
      return this.renderMessage(`Fixture path not found: ${fixtureId.path}`);
    }

    const fixtureExport = fixtures[fixtureId.path].module.default;
    const fixture = getFixture(fixtureExport, fixtureId.name);

    if (typeof fixture === 'undefined') {
      return this.renderMessage(
        `Invalid fixture ID: ${JSON.stringify(fixtureId)}`
      );
    }

    const { systemDecorators, userDecorators, onErrorReset } = this.props;
    const { renderKey } = this.state;
    return (
      <FixtureProvider
        // renderKey controls whether to reuse previous instances (and
        // transition props) or rebuild render tree from scratch
        key={renderKey}
        fixtureId={fixtureId}
        fixture={fixture}
        systemDecorators={systemDecorators}
        userDecorators={userDecorators}
        fixtureState={fixtureState}
        setFixtureState={this.setFixtureState}
        onErrorReset={onErrorReset || noop}
      />
    );
  }

  handleRequest = (msg: RendererRequest) => {
    if (msg.type === 'pingRenderers') {
      return this.postReadyState();
    }

    if (!msg.payload || msg.payload.rendererId !== this.props.rendererId) {
      return;
    }

    if (doesRequestChangeFixture(msg)) {
      this.fireChangeCallback();
    }

    switch (msg.type) {
      case 'selectFixture':
        return this.handleSelectFixtureRequest(msg);
      case 'unselectFixture':
        return this.handleUnselectFixtureRequest();
      case 'setFixtureState':
        return this.handleSetFixtureStateRequest(msg);
      default:
      // This Is Fine™
      // Actually, we can't be angry about getting unrelated messages here
      // because we don't do any preliminary message filtering to ignore stuff
      // like browser devtools communication, nor do we have any message
      // metadata conventions in place to perform such filtering at the moment
    }
  };

  handleSelectFixtureRequest({ payload }: SelectFixtureRequest) {
    const { fixtureId, fixtureState } = payload;
    this.setState({
      selectedFixture: {
        fixtureId,
        fixtureState,
        syncedFixtureState: fixtureState,
      },
      renderKey: this.state.renderKey + 1,
    });
  }

  handleUnselectFixtureRequest() {
    this.setState({
      selectedFixture: null,
      renderKey: 0,
    });
  }

  handleSetFixtureStateRequest({ payload }: SetFixtureStateRequest) {
    const { fixtureId, fixtureState } = payload;
    const { selectedFixture } = this.state;
    // Ensure fixture state applies to currently selected fixture
    if (selectedFixture && isEqual(fixtureId, selectedFixture.fixtureId)) {
      this.setState({
        selectedFixture: {
          fixtureId,
          fixtureState,
          syncedFixtureState: fixtureState,
        },
      });
    }
  }

  postReadyState() {
    const { rendererId, initialFixtureId } = this.props;
    const fixtures = this.getFixtureList();
    this.postMessage({
      type: 'rendererReady',
      payload: initialFixtureId
        ? { rendererId, fixtures, initialFixtureId }
        : { rendererId, fixtures },
    });
  }

  postFixtureListUpdate() {
    const { rendererId } = this.props;
    this.postMessage({
      type: 'fixtureListUpdate',
      payload: {
        rendererId,
        fixtures: this.getFixtureList(),
      },
    });
  }

  postFixtureStateChange = (
    fixtureId: FixtureId,
    fixtureState: FixtureState
  ) => {
    const { rendererId } = this.props;
    this.postMessage({
      type: 'fixtureStateChange',
      payload: {
        rendererId,
        fixtureId,
        fixtureState,
      },
    });
  };

  setFixtureState: SetFixtureState = stateUpdate => {
    if (!this.state.selectedFixture) {
      console.warn(
        '[FixtureLoader] Trying to set fixture state with no fixture selected'
      );
      return;
    }

    // Multiple state changes can be dispatched by fixture plugins at almost
    // the same time. Since state changes are batched in React, current state
    // (this.state.fixtureState) can be stale at dispatch time, and extending
    // it can result in cancelling previous state changes that are queued.
    // Using an updater function like ({ prevState }) => nextState ensures
    // every state change is honored, regardless of timing.
    this.setState(({ selectedFixture }: State) => {
      if (!selectedFixture) {
        return null;
      }

      return {
        selectedFixture: {
          ...selectedFixture,
          fixtureState: stateUpdate(selectedFixture.fixtureState),
        },
      };
    });
  };

  getFixtureList() {
    return getFixtureListFromWrappers(this.props.fixtures);
  }

  fireChangeCallback() {
    const { onErrorReset } = this.props;
    if (typeof onErrorReset === 'function') {
      onErrorReset();
    }
  }

  updateSyncedFixtureState(syncedFixtureState: FixtureState) {
    this.setState(({ selectedFixture }) => {
      if (!selectedFixture) {
        return null;
      }

      // Other updates that alter state.selectedFixture can be pending when this
      // update is submitted. Those updates will be applied first. With this in
      // mind, we use a state setter callback to only override syncedFixtureState
      // and keep the latest values of other state parts.
      return {
        selectedFixture: {
          ...selectedFixture,
          syncedFixtureState,
        },
      };
    });
  }

  postMessage(msg: RendererResponse) {
    this.props.rendererConnect.postMessage(msg);
  }

  renderMessage(msg: string) {
    return typeof this.props.renderMessage !== 'undefined'
      ? this.props.renderMessage({ msg })
      : msg;
  }
}

function doesRequestChangeFixture(r: RendererRequest) {
  return r.type === 'selectFixture' || r.type === 'unselectFixture';
}

function noop() {}
