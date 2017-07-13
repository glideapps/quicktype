module Doc
    ( Doc
    , string
    , line
    , words
    , blank
    , indent
    , class Renderable
    -- Build Doc Unit with monad syntax, then render to string
    , render
    ) where

import Prelude
import Control.Monad.RWS (RWS, evalRWS, gets, modify, tell)
import Control.Monad.State (class MonadState)
import Data.Foldable (intercalate)
import Data.Tuple (snd)


type DocState = { indent :: Int }
newtype Doc a = Doc (RWS Unit String DocState a)

derive newtype instance functorDoc :: Functor Doc
derive newtype instance applyDoc :: Apply Doc
derive newtype instance applicativeDoc :: Applicative Doc
derive newtype instance bindDoc :: Bind Doc
derive newtype instance monadDoc :: Monad Doc
derive newtype instance monadStateDoc :: MonadState { indent :: Int } Doc

class Renderable r where
    render :: r -> String

instance renderableString :: Renderable String where
    render = id

instance renderableDoc :: Renderable (Doc Unit) where
    render (Doc w) = evalRWS w unit { indent: 0 } # snd

line :: forall a. Renderable a => a -> Doc Unit
line a = do
    indent <- gets _.indent
    string $ times "\t" indent
    string $ render a
    string "\n"

-- Cannot make this work any other way!
times :: String -> Int -> String
times s n | n < 1 = ""
times s 1 = s
times s n = s <> times s (n - 1)

string :: String -> Doc Unit
string = Doc <<< tell

blank :: Doc Unit
blank = string "\n"

words :: Array String -> Doc Unit
words = string <<< intercalate " "

indent :: forall a. Doc a -> Doc a
indent doc = do
    modify \s -> { indent: s.indent + 1 }
    a <- doc
    modify \s -> { indent: s.indent - 1 }
    pure a
