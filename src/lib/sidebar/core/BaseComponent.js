// #sidebar/core/BaseComponent.js

/**
 * @file A base class for UI components to handle common lifecycle and state management tasks.
 */

/** @typedef {import('../stores/SessionStore.js').SessionStore} SessionStore */
/** @typedef {import('../core/Coordinator.js').SessionCoordinator} SessionCoordinator */

export class BaseComponent {
    /**
     * @param {object} params
     * @param {HTMLElement} params.container - The DOM element to mount the component into.
     * @param {SessionStore} params.store - The application's state store.
     * @param {SessionCoordinator} params.coordinator - The application's event coordinator.
     */
    constructor({ container, store, coordinator }) {
        if (!container || !store || !coordinator) {
            throw new Error("BaseComponent requires a container, store, and coordinator.");
        }
        
        /** @protected */
        this.container = container;
        /** @protected */
        this.store = store;
        /** @protected */
        this.coordinator = coordinator;
        
        /**
         * The component's local state, derived from the global store state.
         * @protected
         * @type {object}
         */
        this.state = {};
        
        /** 
         * The function to unsubscribe from the store.
         * @private
         * @type {Function | null}
         */
        this._unsubscribe = null;
    }

    /**
     * Initializes the component: subscribes to the store and performs the initial render.
     * This method should be called by the application after instantiation.
     */
    init() {
        this._subscribeToStore();
        // Set initial state and render
        this._updateStateAndRender(this.store.getState());
        this._bindEvents();
    }

    /**
     * Subscribes the component to the store.
     * @private
     */
    _subscribeToStore() {
        if (this._unsubscribe) return; // Already subscribed
        
        this._unsubscribe = this.store.subscribe(globalState => {
            this._updateStateAndRender(globalState);
        });
    }
    
    /**
     * A central method to update state and trigger a re-render if necessary.
     * @param {import('../types/types.js')._SessionState} globalState
     * @private
     */
    _updateStateAndRender(globalState) {
        const newState = this._transformState(globalState);
        
        // A simple shallow comparison to check if a re-render is needed.
        const hasChanged = Object.keys(newState).some(key => this.state[key] !== newState[key]);

        if (hasChanged) {
            this.state = newState;
            this.render();
        }
    }

    /**
     * Transforms the global state into the local state needed by this component.
     * **This method must be implemented by subclasses.**
     * @param {import('../types/types.js')._SessionState} globalState - The global application state.
     * @returns {object} The component's new local state.
     * @protected
     */
    _transformState(globalState) {
        throw new Error("Component must implement the _transformState method.");
    }
    
    /**
     * Renders the component's UI based on its current state.
     * **This method must be implemented by subclasses.**
     * @protected
     */
    render() {
        throw new Error("Component must implement the render method.");
    }
    
    /**
     * Binds DOM event listeners.
     * **This method should be implemented by subclasses if they need to handle DOM events.**
     * @protected
     */
    _bindEvents() {
        // Subclasses can implement this.
    }

    /**
     * Destroys the component, cleans up subscriptions and DOM.
     */
    destroy() {
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        this.container.innerHTML = '';
    }
}
