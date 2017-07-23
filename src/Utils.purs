module Utils
    ( mapM
    , mapMapM
    ) where

import Prelude

import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Tuple (Tuple(..))

mapM :: forall m a b. Monad m => (a -> m b) -> List a -> m (List b)
mapM _ L.Nil = pure L.Nil
mapM f (x : xs) = L.Cons <$> f x <*> mapM f xs

mapMapM :: forall m k v w. Monad m => Ord k  => (k -> v -> m w) -> Map k v -> m (Map k w)
mapMapM f m = do
    l <- mapM mapper (M.toUnfoldable m)
    pure $ M.fromFoldable l
    where
        mapper (Tuple a b) = do
            c <- f a b
            pure $ Tuple a c
