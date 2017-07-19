module Doc
    ( Doc
    , getGraph
    , getClasses
    , getClass
    , class Renderable
    , render
    , string
    , line
    , words
    , blank
    , indent
    -- Build Doc Unit with monad syntax, then render to string
    , runDoc
    ) where

import Prelude

import Control.Monad.RWS (RWS, evalRWS, asks, gets, modify, tell)
import Data.Foldable (for_, intercalate)
import Data.List as L
import Data.Tuple (snd)
import IR (IRClassData(..))
import IR as IR

type DocState = { indent :: Int }
type DocEnv = { graph :: IR.IRGraph }
newtype Doc a = Doc (RWS DocEnv String DocState a)

derive newtype instance functorDoc :: Functor Doc
derive newtype instance applyDoc :: Apply Doc
derive newtype instance applicativeDoc :: Applicative Doc
derive newtype instance bindDoc :: Bind Doc
derive newtype instance monadDoc :: Monad Doc
    
runDoc :: forall a. Doc a -> IR.IRGraph -> String
runDoc (Doc w) graph = evalRWS w { graph } { indent: 0 } # snd

getGraph :: Doc IR.IRGraph
getGraph = Doc (asks _.graph)

getClasses :: Doc (L.List IR.IRClassData)
getClasses = IR.classesInGraph <$> getGraph

getClass :: Int -> Doc IR.IRClassData
getClass i = do
  graph <- getGraph
  pure $ IR.getClassFromGraph graph i

class Renderable r where
  render :: r -> Doc Unit

instance renderableString :: Renderable String where
  render = string

instance renderableDoc :: Renderable (Doc Unit) where
  render = id

instance renderableArray :: Renderable r => Renderable (Array r) where
  render rs = for_ rs render

line :: forall r. Renderable r => r -> Doc Unit
line r = do
    indent <- Doc (gets _.indent)
    string $ times "\t" indent
    render r
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
    Doc $ modify (\s -> { indent: s.indent + 1 })
    a <- doc
    Doc $ modify (\s -> { indent: s.indent - 1 })
    pure a