pub(crate) mod connection_http;
pub(crate) mod connection_types;
pub(crate) mod connection_vault;
pub(crate) mod connections;
pub(crate) mod native;
pub(crate) mod oauth;
pub(crate) mod oauth_loopback;
pub(crate) mod oauth_types;

use self::connection_http as plugin_connection_http;
use self::connection_types as plugin_connection_types;
use self::connection_vault as plugin_connection_vault;
use self::connections as plugin_connections;
use self::native as plugin_native;
use self::oauth as plugin_oauth;
use self::oauth_loopback as plugin_oauth_loopback;
use self::oauth_types as plugin_oauth_types;
