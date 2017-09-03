module Environment
    ( Environment(..)
    , current
    ) where

import Prelude
import Data.Maybe (Maybe(..))

data Environment = Development | Production

type MakeMaybe a = { toJust :: a -> Maybe a, nothing :: Maybe a }

makeMaybe :: forall a. MakeMaybe a
makeMaybe = { toJust: Just, nothing: Nothing }

foreign import _getHostname :: MakeMaybe String -> Maybe String
foreign import _getNodeEnv :: MakeMaybe String -> Maybe String

hostname :: Maybe String
hostname = _getHostname makeMaybe

nodeEnv :: Maybe String
nodeEnv = _getNodeEnv makeMaybe

current :: Environment
current
    | hostname == Just "localhost" || nodeEnv == Just "development" = Development
    | otherwise = Production
